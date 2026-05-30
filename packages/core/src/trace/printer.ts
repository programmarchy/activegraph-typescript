// Trace formatter. Format is the public contract.
//
// Layout: tag column is left-aligned, padded to 26 chars; if the tag itself
// is longer, exactly one space follows it.

import { writeFileSync } from "node:fs";

import type { Event } from "../event.js";
import type { Graph } from "../graph.js";
import { causalChain } from "./causal.js";

const TAG_COL = 26;

function formatTag(tagText: string): string {
  const bracketed = `[${tagText}]`;
  if (bracketed.length >= TAG_COL) return `${bracketed} `;
  return bracketed.padEnd(TAG_COL, " ");
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n !== 1 ? "s" : ""}`;
}

function money(v: unknown): string {
  const n = Number(v);
  if (Number.isFinite(n)) return n.toFixed(3);
  return String(v);
}

function shortHash(h: unknown): string {
  if (typeof h !== "string") return String(h);
  return h.length > 8 ? h.slice(0, 8) : h;
}

function payloadString(payload: Record<string, unknown>, key: string, fallback = "?"): string {
  const v = payload[key];
  return v !== undefined && v !== null ? String(v) : fallback;
}

function payloadObj(payload: Record<string, unknown>, key: string): Record<string, unknown> {
  const v = payload[key];
  return v !== null && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

// ---- per-event formatters ----

function fmtGoalCreated(e: Event): string {
  const actor = e.actor ?? "user";
  const goal = payloadString(e.payload, "goal", "");
  return `${formatTag("goal.created")}${actor}: "${goal}"`;
}

function fmtObjectCreated(e: Event): string {
  const o = payloadObj(e.payload, "object");
  const data = (o.data as Record<string, unknown> | undefined) ?? {};
  const label = (data.title ?? data.text ?? "") as string;
  const labelS = label !== "" ? ` "${label}"` : "";
  const status = data.status;
  const statusS = status !== undefined && status !== null ? ` (${String(status)})` : "";
  const id = o.id !== undefined ? String(o.id) : "?";
  return `${formatTag("object.created")}${id}${labelS}${statusS}`;
}

function fmtObjectRemoved(e: Event): string {
  return `${formatTag("object.removed")}${payloadString(e.payload, "id")}`;
}

function fmtRelationCreated(e: Event): string {
  const r = payloadObj(e.payload, "relation");
  const src = r.source !== undefined ? String(r.source) : "?";
  const tgt = r.target !== undefined ? String(r.target) : "?";
  const typ = r.type !== undefined ? String(r.type) : "?";
  return `${formatTag("relation.created")}${src} --${typ}--> ${tgt}`;
}

function fmtRelationRemoved(e: Event): string {
  return `${formatTag("relation.removed")}${payloadString(e.payload, "id")}`;
}

function fmtPatchApplied(e: Event): string {
  const target = payloadString(e.payload, "target");
  const diff = payloadObj(e.payload, "diff");
  if (Object.keys(diff).length === 0) {
    return `${formatTag("patch.applied")}${target} (no change)`;
  }
  const lines: string[] = [];
  for (const [field, change] of Object.entries(diff)) {
    const c = (change ?? {}) as Record<string, unknown>;
    lines.push(`${formatTag("patch.applied")}${target} ${field}: ${String(c.old)} -> ${String(c.new)}`);
  }
  return lines.join("\n");
}

function fmtPatchProposed(e: Event): string {
  const p = payloadObj(e.payload, "patch");
  const target = p.target !== undefined ? String(p.target) : "?";
  const op = p.op !== undefined ? String(p.op) : "?";
  const by = p.proposed_by !== undefined ? String(p.proposed_by) : "?";
  return `${formatTag("patch.proposed")}${target} ${op} by ${by}`;
}

function fmtPatchRejected(e: Event): string {
  return `${formatTag("patch.rejected")}${payloadString(e.payload, "patch_id")}: ${payloadString(e.payload, "reason")}`;
}

function fmtBehaviorStarted(e: Event): string {
  const name = payloadString(e.payload, "behavior");
  const triggeringType = e.payload.triggering_event_type;
  const triggeringId = e.payload.triggering_object_id;
  if (triggeringType !== undefined && triggeringId !== undefined) {
    return `${formatTag("behavior.started")}${name}  (matched ${String(triggeringType)}: ${String(triggeringId)})`;
  }
  return `${formatTag("behavior.started")}${name}`;
}

function fmtRelationBehaviorStarted(e: Event): string {
  const name = payloadString(e.payload, "behavior");
  const triggeringType = payloadString(e.payload, "triggering_event_type");
  const relationType = payloadString(e.payload, "relation_type");
  return `${formatTag("relation_behavior.started")}${name}  (matched ${triggeringType} on ${relationType} edge)`;
}

function fmtBehaviorCompleted(e: Event): string {
  const name = payloadString(e.payload, "behavior");
  const nObj = Number(e.payload.objects_created ?? 0);
  const nRel = Number(e.payload.relations_created ?? 0);
  if (nObj + nRel >= 2) {
    return `${formatTag("behavior.completed")}${name} (${plural(nObj, "object")}, ${plural(nRel, "relation")})`;
  }
  return `${formatTag("behavior.completed")}${name}`;
}

function fmtBehaviorFailed(e: Event): string {
  const name = payloadString(e.payload, "behavior");
  const et = payloadString(e.payload, "exception_type");
  const msg = payloadString(e.payload, "message", "");
  return `${formatTag("behavior.failed")}${name}: ${et}: ${msg}`;
}

function fmtLLMRequested(e: Event, hidePromptNormalized = false): string {
  const p = e.payload;
  const name = payloadString(p, "behavior");
  const parts: string[] = [`${e.id}  ${name}`, `model=${payloadString(p, "model")}`];
  if (p.cache_hit) parts.push("cache_hit=true");
  const turnIdx = p.turn_index;
  if (typeof turnIdx === "number" && turnIdx > 0) parts.push(`turn=${turnIdx}`);
  if (p.estimated_input_tokens !== undefined) parts.push(`tokens_in~${String(p.estimated_input_tokens)}`);
  if (p.budget_remaining_usd !== undefined && p.budget_remaining_usd !== null) {
    parts.push(`budget_remaining=$${money(p.budget_remaining_usd)}`);
  }
  if (p.prompt_normalized && !hidePromptNormalized) parts.push("prompt_normalized=true");
  return `${formatTag("llm.requested")}${parts[0]}  ${parts.slice(1).join(" ")}`;
}

function fmtLLMResponded(e: Event): string {
  const p = e.payload;
  const name = payloadString(p, "behavior");
  const parts: string[] = [`${e.id}  ${name}`];
  if (p.cache_hit) parts.push("cache_hit=true");
  const inTok = p.input_tokens;
  const outTok = p.output_tokens;
  if (inTok !== undefined && inTok !== null) parts.push(`tokens_in=${String(inTok)}`);
  if (outTok !== undefined && outTok !== null) parts.push(`tokens_out=${String(outTok)}`);
  const cost = p.cost_usd;
  if (cost !== undefined && cost !== null && !p.cache_hit) parts.push(`cost=$${money(cost)}`);
  const lat = p.latency_seconds;
  if (lat !== undefined && lat !== null && !p.cache_hit) parts.push(`latency=${Number(lat).toFixed(1)}s`);
  return `${formatTag("llm.responded")}${parts[0]}  ${parts.slice(1).join(" ")}`;
}

function fmtToolRequested(e: Event): string {
  const p = e.payload;
  const name = payloadString(p, "behavior");
  const tool = payloadString(p, "tool");
  const parts: string[] = [`${e.id}  ${name}`, `tool=${tool}`, `args_hash=${shortHash(p.args_hash)}`];
  if (p.cache_hit) parts.push("cache_hit=true");
  if (p.deterministic) parts.push("deterministic=true");
  return `${formatTag("tool.requested")}${parts[0]}  ${parts.slice(1).join(" ")}`;
}

function fmtToolResponded(e: Event): string {
  const p = e.payload;
  const name = payloadString(p, "behavior");
  const tool = payloadString(p, "tool");
  const parts: string[] = [`${e.id}  ${name}`, `tool=${tool}`];
  if (p.cache_hit) parts.push("cache_hit=true");
  const err = p.error;
  if (err !== undefined && err !== null) {
    const reason =
      typeof err === "object" ? ((err as Record<string, unknown>).reason ?? "tool.error") : "tool.error";
    parts.push(`error=${String(reason)}`);
  } else {
    const lat = p.latency_seconds;
    const cost = p.cost_usd;
    if (lat !== undefined && lat !== null && !p.cache_hit) parts.push(`latency=${Number(lat).toFixed(1)}s`);
    if (cost !== undefined && cost !== null && !p.cache_hit) parts.push(`cost=$${money(cost)}`);
  }
  return `${formatTag("tool.responded")}${parts[0]}  ${parts.slice(1).join(" ")}`;
}

function fmtPatternMatched(e: Event): string {
  const name = payloadString(e.payload, "behavior");
  const n = Number(e.payload.matches_count ?? 0);
  return `${formatTag("pattern.matched")}${e.id}  ${name}  matches=${n}`;
}

function fmtBehaviorScheduled(e: Event): string {
  const name = payloadString(e.payload, "behavior");
  const n = Number(e.payload.activate_after ?? 0);
  return `${formatTag("behavior.scheduled")}${e.id}  ${name}  activate_after=${n}_event${n !== 1 ? "s" : ""}`;
}

function fmtRuntimeIdle(_: Event): string {
  return `${formatTag("runtime.idle")}queue empty, budget remaining`;
}

function fmtRuntimeBudgetExhausted(e: Event): string {
  const by = payloadString(e.payload, "exhausted_by");
  return `${formatTag("runtime.budget_exhausted")}stopped: ${by}`;
}

function fmtPackLoaded(e: Event): string {
  const p = e.payload;
  const name = payloadString(p, "name");
  const version = payloadString(p, "version");
  const counts: [number, string, string][] = [
    [arrLen(p.object_types), "object_type", "object_types"],
    [arrLen(p.relation_types), "relation_type", "relation_types"],
    [arrLen(p.behaviors), "behavior", "behaviors"],
    [arrLen(p.tools), "tool", "tools"],
    [arrLen(p.policies), "policy", "policies"],
    [
      typeof p.prompts === "object" && p.prompts !== null ? Object.keys(p.prompts as object).length : 0,
      "prompt",
      "prompts",
    ],
  ];
  const summary = counts
    .filter(([n]) => n > 0)
    .map(([n, singular, plur]) => `${n} ${n === 1 ? singular : plur}`)
    .join(", ");
  return `${formatTag("pack.loaded")}${name} v${version} (${summary})`;
}

function arrLen(v: unknown): number {
  return Array.isArray(v) ? v.length : 0;
}

function fmtEventEmitted(e: Event): string {
  const parts: string[] = [e.type];
  for (const [k, v] of Object.entries(e.payload)) {
    parts.push(`${k}=${shortValue(v)}`);
  }
  return `${formatTag("event.emitted")}${parts.join(" ")}`;
}

function shortValue(v: unknown): string {
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

const FORMATTERS: Record<string, (e: Event) => string> = {
  "goal.created": fmtGoalCreated,
  "object.created": fmtObjectCreated,
  "object.removed": fmtObjectRemoved,
  "relation.created": fmtRelationCreated,
  "relation.removed": fmtRelationRemoved,
  "patch.applied": fmtPatchApplied,
  "patch.proposed": fmtPatchProposed,
  "patch.rejected": fmtPatchRejected,
  "behavior.started": fmtBehaviorStarted,
  "behavior.completed": fmtBehaviorCompleted,
  "behavior.failed": fmtBehaviorFailed,
  "behavior.scheduled": fmtBehaviorScheduled,
  "relation_behavior.started": fmtRelationBehaviorStarted,
  "llm.responded": fmtLLMResponded,
  "tool.requested": fmtToolRequested,
  "tool.responded": fmtToolResponded,
  "pattern.matched": fmtPatternMatched,
  "runtime.idle": fmtRuntimeIdle,
  "pack.loaded": fmtPackLoaded,
  "runtime.budget_exhausted": fmtRuntimeBudgetExhausted,
};

export function formatEvent(event: Event, opts: { hidePromptNormalized?: boolean } = {}): string {
  if (event.type === "llm.requested") {
    return fmtLLMRequested(event, opts.hidePromptNormalized ?? false);
  }
  const fn = FORMATTERS[event.type] ?? fmtEventEmitted;
  return fn(event);
}

// ---- replay rendering ----

function fmtReplay(event: Event): string {
  const t = event.type;
  const p = event.payload;
  let body: string;
  if (t === "object.created") {
    const o = payloadObj(p, "object");
    const data = (o.data as Record<string, unknown> | undefined) ?? {};
    const label = (data.title ?? data.text ?? "") as string;
    const labelS = label !== "" ? ` "${label}"` : "";
    body = `${event.id} ${t} ${o.id !== undefined ? String(o.id) : "?"}${labelS}`;
  } else if (t === "relation.created") {
    const r = payloadObj(p, "relation");
    body = `${event.id} ${t} ${String(r.source)} --${String(r.type)}--> ${String(r.target)}`;
  } else if (t === "patch.applied") {
    body = `${event.id} ${t} ${payloadString(p, "target")}`;
  } else if (t === "goal.created") {
    body = `${event.id} ${t} "${payloadString(p, "goal", "")}"`;
  } else if (
    t === "behavior.started" ||
    t === "behavior.completed" ||
    t === "behavior.failed" ||
    t === "relation_behavior.started"
  ) {
    body = `${event.id} ${t} ${payloadString(p, "behavior")}`;
  } else {
    body = `${event.id} ${t}`;
  }
  return `${formatTag("replay.event")}${body}`;
}

function fmtReplayComplete(n: number): string {
  return `${formatTag("replay.complete")}${n} events replayed, graph reconstructed`;
}

function fmtReplayReady(): string {
  return `${formatTag("runtime.idle")}ready to resume`;
}

// ---- prompt_normalized rollup ----

interface PromptNormalizedRollup {
  promptNormalized: true;
  count: number;
}

function computePromptNormalizedRollup(
  events: readonly Event[],
  replayed: ReadonlySet<string>,
): PromptNormalizedRollup | null {
  const llmReqs = events.filter((e) => e.type === "llm.requested" && !replayed.has(e.id));
  if (llmReqs.length === 0) return null;
  if (!llmReqs.every((e) => e.payload.prompt_normalized === true)) return null;
  return { promptNormalized: true, count: llmReqs.length };
}

function fmtTraceFlags(rollup: PromptNormalizedRollup): string {
  return `${formatTag("trace.flags")}prompt_normalized=true (${plural(rollup.count, "llm request")})`;
}

// ---- Trace facade ----

export class Trace {
  constructor(private readonly graph: Graph) {}

  lines(): string[] {
    const replayed = this.graph.replayedIds;
    const replayedCount = replayed.size;
    const rollup = computePromptNormalizedRollup(this.graph.events, replayed);
    const hidePerLine = rollup !== null;
    const out: string[] = [];
    let emittedBoundary = false;
    let emittedFlags = false;
    for (const e of this.graph.events) {
      if (replayed.has(e.id)) {
        out.push(fmtReplay(e));
        continue;
      }
      if (replayedCount > 0 && !emittedBoundary) {
        out.push(fmtReplayComplete(replayedCount));
        out.push(fmtReplayReady());
        emittedBoundary = true;
      }
      if (rollup !== null && !emittedFlags) {
        out.push(fmtTraceFlags(rollup));
        emittedFlags = true;
      }
      out.push(formatEvent(e, { hidePromptNormalized: hidePerLine }));
    }
    if (replayedCount > 0 && !emittedBoundary) {
      out.push(fmtReplayComplete(replayedCount));
      out.push(fmtReplayReady());
    }
    return out;
  }

  print(): void {
    for (const line of this.lines()) {
      // biome-ignore lint/suspicious/noConsole: trace printer is a CLI surface
      console.log(line);
    }
  }

  export(path: string): void {
    writeFileSync(path, `${this.lines().join("\n")}\n`);
  }

  causalChain(objectId: string): string {
    return causalChain(this.graph, objectId);
  }
}
