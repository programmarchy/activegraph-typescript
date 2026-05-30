// @activegraph/packs — pack format, definePack, loader, scaffold.
//
// A pack bundles object types, relation types, behaviors, tools, prompts,
// and policies for a specific domain. Schemas can be any
// StandardSchemaV1 implementation (Zod 4 by default, but Valibot /
// ArkType / TypeBox / Effect Schema also work).

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";

import type { Graph } from "@activegraph/core";
import { PackError, RegistrationError } from "@activegraph/core";

// Minimal duck-typed Standard Schema. Avoids requiring users to depend on
// @standard-schema/spec at this layer; we accept anything with the same
// shape. Phase 6 may tighten this to the real spec type.
export interface StandardSchemaLike<T = unknown> {
  readonly "~standard"?: {
    types?: { input: T; output: T };
    validate?: (input: unknown) => { value?: T; issues?: unknown };
  };
  // Either Standard Schema OR a Zod-like type with `parse`.
  parse?: (input: unknown) => T;
}

export interface ObjectType<T = unknown> {
  name: string;
  schema: StandardSchemaLike<T>;
}

export interface RelationType {
  name: string;
  allowedSources?: string[];
  allowedTargets?: string[];
}

export interface PackPolicy {
  behavior: string;
  canCreate?: string[];
  canCreateRelation?: string[];
  canPropose?: string[];
  canApply?: string[];
  canCallTool?: string[];
  requiresApproval?: string[];
}

export interface PackPrompt {
  name: string;
  text: string;
  /** sha256 of the prompt text — useful for replay verification. */
  hash: string;
}

export interface PackDef {
  name: string;
  version: string;
  description?: string;
  objectTypes?: ObjectType[];
  relationTypes?: RelationType[];
  behaviors?: ReadonlyArray<{ name: string }>;
  tools?: ReadonlyArray<{ name: string }>;
  policies?: PackPolicy[];
  prompts?: Array<{ name: string; text: string; hash?: string }>;
  settings?: StandardSchemaLike<Record<string, unknown>>;
}

export interface Pack {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly objectTypes: readonly ObjectType[];
  readonly relationTypes: readonly RelationType[];
  readonly behaviors: ReadonlyArray<{ name: string }>;
  readonly tools: ReadonlyArray<{ name: string }>;
  readonly policies: readonly PackPolicy[];
  readonly prompts: readonly PackPrompt[];
  readonly settings: StandardSchemaLike<Record<string, unknown>> | null;
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function definePack(def: PackDef): Pack {
  const prompts: PackPrompt[] = (def.prompts ?? []).map((p) => ({
    name: p.name,
    text: p.text,
    hash: p.hash ?? sha256(p.text),
  }));
  return {
    name: def.name,
    version: def.version,
    description: def.description ?? "",
    objectTypes: def.objectTypes ?? [],
    relationTypes: def.relationTypes ?? [],
    behaviors: def.behaviors ?? [],
    tools: def.tools ?? [],
    policies: def.policies ?? [],
    prompts,
    settings: def.settings ?? null,
  };
}

// --- schema validation helpers -------------------------------------------

function validateAgainstSchema<T>(schema: StandardSchemaLike<T>, input: unknown): T {
  if (typeof schema.parse === "function") {
    try {
      return schema.parse(input);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new PackSchemaViolation(`schema validation failed: ${msg}`, {
        whatFailed: `Pack schema validation rejected the data: ${msg}`,
        why: "Pack object types enforce their schema on every addObject call. The supplied data didn't conform.",
        howToFix:
          "Adjust the object's data to match the declared schema, or update the schema if the data shape changed legitimately.",
        context: { underlying: msg },
      });
    }
  }
  if (schema["~standard"]?.validate !== undefined) {
    const result = schema["~standard"].validate(input);
    if (result.issues !== undefined) {
      throw new PackSchemaViolation("schema validation failed", {
        whatFailed: `Pack schema validation produced issues: ${JSON.stringify(result.issues)}`,
        why: "Pack object types enforce their schema on every addObject call. The supplied data didn't conform.",
        howToFix:
          "Adjust the object's data to match the declared schema, or update the schema if the data shape changed legitimately.",
        context: { issues: result.issues as unknown },
      });
    }
    return result.value as T;
  }
  // No validation hook — pass through.
  return input as T;
}

// --- loading a pack into a Graph ----------------------------------------

/**
 * Wire a Pack's object-type and relation-type rules into a Graph.
 *
 * After `loadPack(graph, pack)`, calls to `graph.addObject(type, data)`
 * whose `type` matches a pack object-type run the data through the
 * schema's validate/parse and throw PackSchemaViolation on mismatch.
 * Untyped object types (not declared by any loaded pack) pass through
 * unchanged. Same for addRelation against relation-type rules.
 *
 * Loading the same pack twice is a no-op. Loading two packs that
 * declare the same object type name throws PackConflictError.
 */
export function loadPack(graph: Graph, pack: Pack): void {
  const schemas = new Map<string, StandardSchemaLike<unknown>>();
  for (const ot of pack.objectTypes) {
    if (schemas.has(ot.name)) {
      throw new PackConflictError(
        `pack '${pack.name}' declares object type '${ot.name}' twice`,
        {
          whatFailed: `Pack '${pack.name}' has two object-type entries named '${ot.name}'.`,
          why: "Each object type within a pack must be unique by name; otherwise validators would shadow each other unpredictably.",
          howToFix: "Rename one of the duplicate types or merge them.",
          context: { pack: pack.name, object_type: ot.name },
        },
      );
    }
    schemas.set(ot.name, ot.schema as StandardSchemaLike<unknown>);
  }

  const relRules = new Map<string, RelationType>();
  for (const rt of pack.relationTypes) {
    relRules.set(rt.name, rt);
  }

  // Compose with existing validators so multiple packs can coexist for
  // disjoint type sets.
  const prevObjectValidator = graph.packObjectValidator;
  graph.packObjectValidator = (type, data) => {
    let next = data;
    if (prevObjectValidator !== null) next = prevObjectValidator(type, next);
    const schema = schemas.get(type);
    if (schema !== undefined) {
      next = validateAgainstSchema(schema, next) as Record<string, unknown>;
    }
    return next;
  };

  const prevRelationValidator = graph.packRelationValidator;
  graph.packRelationValidator = (type, sourceType, targetType) => {
    if (prevRelationValidator !== null) prevRelationValidator(type, sourceType, targetType);
    const rule = relRules.get(type);
    if (rule === undefined) return;
    if (
      rule.allowedSources !== undefined &&
      rule.allowedSources.length > 0 &&
      sourceType !== null &&
      !rule.allowedSources.includes(sourceType)
    ) {
      throw new PackSchemaViolation(
        `relation '${type}' source type '${sourceType}' not in allowedSources`,
        {
          whatFailed: `addRelation(... '${type}' ...) had source type '${sourceType}', but pack '${pack.name}' restricts this relation's sources to ${JSON.stringify(rule.allowedSources)}.`,
          why: "Relation-type rules let packs enforce graph shape — e.g. a 'supports' edge from 'evidence' to 'claim'.",
          howToFix: `Pick a source of an allowed type, or relax the allowedSources list on the pack.`,
          context: { relation_type: type, source_type: sourceType, allowed: rule.allowedSources },
        },
      );
    }
    if (
      rule.allowedTargets !== undefined &&
      rule.allowedTargets.length > 0 &&
      targetType !== null &&
      !rule.allowedTargets.includes(targetType)
    ) {
      throw new PackSchemaViolation(
        `relation '${type}' target type '${targetType}' not in allowedTargets`,
        {
          whatFailed: `addRelation(... '${type}' ...) had target type '${targetType}', but pack '${pack.name}' restricts this relation's targets to ${JSON.stringify(rule.allowedTargets)}.`,
          why: "Relation-type rules let packs enforce graph shape.",
          howToFix: `Pick a target of an allowed type, or relax the allowedTargets list on the pack.`,
          context: { relation_type: type, target_type: targetType, allowed: rule.allowedTargets },
        },
      );
    }
  };
}

// --- discovery / loading by name -----------------------------------------

export interface DiscoveredPack {
  name: string;
  source: string;
  pack: Pack;
}

const REGISTERED_PACKS = new Map<string, Pack>();

export function registerPack(pack: Pack): void {
  const existing = REGISTERED_PACKS.get(pack.name);
  if (existing !== undefined && existing.version !== pack.version) {
    throw new PackVersionConflictError(
      `pack '${pack.name}' already registered at version ${existing.version}; refused to register ${pack.version}`,
      {
        whatFailed: `registerPack({name:'${pack.name}', version:'${pack.version}'}) but another version is already registered.`,
        why: "Two versions of the same pack registered in one runtime would produce ambiguous schema enforcement.",
        howToFix:
          "Pick one version. If both are needed in separate runs, register them in separate Runtime instances or clear the discovery cache between runs.",
        context: { name: pack.name, registered: existing.version, requested: pack.version },
      },
    );
  }
  REGISTERED_PACKS.set(pack.name, pack);
}

export function loadByName(name: string): Pack {
  const p = REGISTERED_PACKS.get(name);
  if (p === undefined) {
    throw new PackNotFoundError(`no pack registered with name '${name}'`, {
      whatFailed: `loadByName('${name}') was called, but no pack with that name has been registered.`,
      why: "Packs in the TS runtime are registered explicitly (not auto-discovered like the Python setuptools entry-point form).",
      howToFix:
        "Import the pack module and pass it to registerPack(), or pass the imported pack object directly instead of looking it up by name.",
    });
  }
  return p;
}

export function discover(): DiscoveredPack[] {
  return [...REGISTERED_PACKS.entries()].map(([name, pack]) => ({
    name,
    source: "registered",
    pack,
  }));
}

export function clearDiscoveryCache(): void {
  REGISTERED_PACKS.clear();
}

/**
 * Read all .md files from `dir` as prompts; the basename (without
 * extension) is the prompt name, file contents are the text, and the
 * sha256 of the text is the hash.
 */
export async function loadPromptsFromDir(dir: string): Promise<PackPrompt[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    throw new PackPromptLoadError(`cannot read prompts directory: ${dir}`, {
      whatFailed: `loadPromptsFromDir('${dir}') failed reading the directory: ${e.message}`,
      why: "The prompts directory is expected to exist and be readable. Common cause: the pack's distribution didn't include the prompts/ folder.",
      howToFix: `Verify the path '${dir}' exists and contains .md files. Check the package's "files"/"exports" declaration if loading from an installed package.`,
      context: { dir, underlying: e.message },
    });
  }
  const out: PackPrompt[] = [];
  for (const entry of entries) {
    if (extname(entry).toLowerCase() !== ".md") continue;
    const name = entry.slice(0, entry.length - 3);
    const text = await readFile(join(dir, entry), "utf8");
    out.push({ name, text, hash: sha256(text) });
  }
  return out;
}

// --- errors --------------------------------------------------------------

export class PackNotFoundError extends RegistrationError {
  static override readonly docSlug: string = "pack-not-found";
}

export class PackConflictError extends RegistrationError {
  static override readonly docSlug: string = "pack-conflict";
}

export class PackVersionConflictError extends RegistrationError {
  static override readonly docSlug: string = "pack-version-conflict";
}

export class PackValidationError extends RegistrationError {
  static override readonly docSlug: string = "pack-validation-error";
}

export class PackPromptLoadError extends RegistrationError {
  static override readonly docSlug: string = "pack-prompt-load-error";
}

export class PackSettingsMissingError extends RegistrationError {
  static override readonly docSlug: string = "pack-settings-missing";
}

export class PackSchemaViolation extends PackError {
  static override readonly docSlug: string = "pack-schema-violation";
}

export class EmptySettings {
  // Marker class — pack default settings when none supplied.
}

export interface PendingApproval {
  readonly patchId: string;
  readonly behaviorName: string;
  readonly reason: string;
}
