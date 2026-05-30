// @activegraph/packs — pack format, definePack, loader, scaffold.
//
// A pack bundles object types, relation types, behaviors, tools, prompts,
// and policies for a specific domain. Schemas can be any
// StandardSchemaV1 implementation (Zod 4 by default, but Valibot /
// ArkType / TypeBox / Effect Schema also work).

import { PackError, RegistrationError } from "@activegraph/core";

// Minimal duck-typed Standard Schema. Avoids requiring users to depend on
// @standard-schema/spec at this layer; we accept anything with the same
// shape. Phase 6 may tighten this to the real spec type.
export interface StandardSchemaLike<T = unknown> {
  readonly "~standard"?: { types?: { input: T; output: T } };
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
  prompts?: PackPrompt[];
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

export function definePack(def: PackDef): Pack {
  return {
    name: def.name,
    version: def.version,
    description: def.description ?? "",
    objectTypes: def.objectTypes ?? [],
    relationTypes: def.relationTypes ?? [],
    behaviors: def.behaviors ?? [],
    tools: def.tools ?? [],
    policies: def.policies ?? [],
    prompts: def.prompts ?? [],
    settings: def.settings ?? null,
  };
}

// --- discovery / loading -------------------------------------------------

export interface DiscoveredPack {
  name: string;
  source: string;
  pack: Pack;
}

const REGISTERED_PACKS = new Map<string, Pack>();

export function registerPack(pack: Pack): void {
  REGISTERED_PACKS.set(pack.name, pack);
}

export function loadByName(name: string): Pack {
  const p = REGISTERED_PACKS.get(name);
  if (p === undefined) {
    throw new PackNotFoundError(`no pack registered with name '${name}'`, {
      whatFailed: `loadByName('${name}') was called, but no pack with that name has been registered.`,
      why: "Packs in the TS runtime are registered explicitly (not auto-discovered like the Python setuptools entry-point form). The name lookup only sees packs you've imported and called registerPack() on.",
      howToFix: `Import the pack module and pass it to registerPack(), or pass the imported pack object directly instead of looking it up by name.`,
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

export async function loadPromptsFromDir(_dir: string): Promise<PackPrompt[]> {
  // TODO(phase-6): read markdown files from disk, hash, return.
  return [];
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
