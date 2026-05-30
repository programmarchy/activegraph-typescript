// Behavior + RelationBehavior + LLMBehavior.
//
// A Behavior is data, not magic. The factory functions wrap a handler in
// one of these and (by default) push them into a global registry that
// Runtime reads when constructed.

import type { Event, Graph, WhereClause } from "@activegraph/core";

import type { RuntimeContext } from "./context.js";
import { type PatternMatcher, parse as parsePattern } from "./patterns.js";

export type BehaviorHandler = (
  event: Event,
  graph: Graph,
  ctx: RuntimeContext,
) => void | Promise<void>;

export type RelationBehaviorHandler = (
  relation: import("@activegraph/core").Relation,
  event: Event,
  graph: Graph,
  ctx: RuntimeContext,
) => void | Promise<void>;

export type LLMBehaviorHandler<Output = unknown> = (
  event: Event,
  graph: Graph,
  ctx: RuntimeContext,
  output: Output,
) => void | Promise<void>;

export interface ViewSpec {
  around?: string;
  depth?: number;
  recentEvents?: number;
  types?: string[];
}

export interface BehaviorDef {
  name: string;
  handler: BehaviorHandler;
  on?: string[];
  where?: WhereClause;
  viewSpec?: ViewSpec;
  creates?: string[];
  budget?: Record<string, unknown>;
  priority?: number;
  pattern?: string;
  activateAfter?: number;
}

export interface RelationBehaviorDef {
  name: string;
  relationType: string;
  handler: RelationBehaviorHandler;
  on?: string[];
  where?: WhereClause;
  viewSpec?: ViewSpec;
  creates?: string[];
  budget?: Record<string, unknown>;
  priority?: number;
  pattern?: string;
  activateAfter?: number;
}

/** Output-schema duck type. Compatible with any StandardSchemaV1 validator. */
export interface OutputSchema<Output> {
  // Marker for the inferred output type. Implementations vary.
  readonly _output?: Output;
}

export interface LLMBehaviorDef<Output = unknown> {
  name: string;
  description?: string;
  on?: string[];
  where?: WhereClause;
  viewSpec?: ViewSpec;
  creates?: string[];
  budget?: Record<string, unknown>;
  priority?: number;
  pattern?: string;
  activateAfter?: number;
  model?: string;
  outputSchema?: OutputSchema<Output>;
  deterministic?: boolean;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  timeoutSeconds?: number;
  promptTemplate?: string;
  tools?: Array<string | { name: string }>;
  maxToolTurns?: number;
  handler: LLMBehaviorHandler<Output>;
}

export interface Behavior {
  readonly kind: "behavior";
  readonly name: string;
  readonly handler: BehaviorHandler;
  readonly on: readonly string[];
  readonly where: WhereClause | null;
  readonly viewSpec: ViewSpec | null;
  readonly creates: readonly string[];
  readonly priority: number;
  readonly pattern: string | null;
  /** Compiled at registration time. null when pattern is null. */
  readonly matcher: PatternMatcher | null;
  readonly activateAfter: number | null;
}

export interface RelationBehavior {
  readonly kind: "relationBehavior";
  readonly name: string;
  readonly relationType: string;
  readonly handler: RelationBehaviorHandler;
  readonly on: readonly string[];
  readonly where: WhereClause | null;
  readonly viewSpec: ViewSpec | null;
  readonly creates: readonly string[];
  readonly priority: number;
  readonly pattern: string | null;
  readonly matcher: PatternMatcher | null;
  readonly activateAfter: number | null;
}

export interface LLMBehavior<Output = unknown> {
  readonly kind: "llmBehavior";
  readonly name: string;
  readonly description: string;
  readonly handler: LLMBehaviorHandler<Output>;
  readonly on: readonly string[];
  readonly where: WhereClause | null;
  readonly viewSpec: ViewSpec | null;
  readonly creates: readonly string[];
  readonly priority: number;
  readonly pattern: string | null;
  readonly matcher: PatternMatcher | null;
  readonly activateAfter: number | null;
  readonly model: string | null;
  readonly outputSchema: OutputSchema<Output> | null;
  readonly deterministic: boolean;
  readonly maxTokens: number;
  readonly temperature: number;
  readonly topP: number;
  readonly timeoutSeconds: number;
  readonly promptTemplate: string | null;
  readonly tools: ReadonlyArray<string | { name: string }>;
  readonly maxToolTurns: number;
}

export type AnyBehavior = Behavior | RelationBehavior | LLMBehavior<unknown>;

// --- global registry ------------------------------------------------------

const REGISTRY: AnyBehavior[] = [];

export function getRegistry(): readonly AnyBehavior[] {
  return REGISTRY;
}

export function clearRegistry(): AnyBehavior[] {
  const cleared = [...REGISTRY];
  REGISTRY.length = 0;
  return cleared;
}

function register<T extends { kind: AnyBehavior["kind"] }>(b: T): T {
  REGISTRY.push(b as unknown as AnyBehavior);
  return b;
}

// --- factories ------------------------------------------------------------

function compileMatcher(pattern: string | null | undefined): PatternMatcher | null {
  return pattern ? parsePattern(pattern).compile() : null;
}

export function defineBehavior(def: BehaviorDef): Behavior {
  return register<Behavior>({
    kind: "behavior",
    name: def.name,
    handler: def.handler,
    on: def.on ?? [],
    where: def.where ?? null,
    viewSpec: def.viewSpec ?? null,
    creates: def.creates ?? [],
    priority: def.priority ?? 0,
    pattern: def.pattern ?? null,
    matcher: compileMatcher(def.pattern),
    activateAfter: def.activateAfter ?? null,
  });
}

export function defineRelationBehavior(def: RelationBehaviorDef): RelationBehavior {
  return register<RelationBehavior>({
    kind: "relationBehavior",
    name: def.name,
    relationType: def.relationType,
    handler: def.handler,
    on: def.on ?? [],
    where: def.where ?? null,
    viewSpec: def.viewSpec ?? null,
    creates: def.creates ?? [],
    priority: def.priority ?? 0,
    pattern: def.pattern ?? null,
    matcher: compileMatcher(def.pattern),
    activateAfter: def.activateAfter ?? null,
  });
}

export function defineLLMBehavior<Output = unknown>(
  def: LLMBehaviorDef<Output>,
): LLMBehavior<Output> {
  return register<LLMBehavior<Output>>({
    kind: "llmBehavior",
    name: def.name,
    description: def.description ?? "",
    handler: def.handler,
    on: def.on ?? [],
    where: def.where ?? null,
    viewSpec: def.viewSpec ?? null,
    creates: def.creates ?? [],
    priority: def.priority ?? 0,
    pattern: def.pattern ?? null,
    matcher: compileMatcher(def.pattern),
    activateAfter: def.activateAfter ?? null,
    model: def.model ?? null,
    outputSchema: def.outputSchema ?? null,
    deterministic: def.deterministic ?? false,
    maxTokens: def.maxTokens ?? 4096,
    temperature: def.temperature ?? 0.7,
    topP: def.topP ?? 1.0,
    timeoutSeconds: def.timeoutSeconds ?? 60,
    promptTemplate: def.promptTemplate ?? null,
    tools: def.tools ?? [],
    maxToolTurns: def.maxToolTurns ?? 6,
  });
}
