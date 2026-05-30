// Tool dispatch lifecycle — tool.requested / tool.responded events,
// args_hash, cache for deterministic tools, structured error responses.

import { createHash } from "node:crypto";

import type { Event, Graph } from "@activegraph/core";
import { makeEvent } from "@activegraph/core";
import type { Tool, ToolContext, ToolError, ToolResult } from "@activegraph/tools";

import type { Budget } from "./budget.js";

// --- args hashing --------------------------------------------------------

/**
 * Stable JSON serializer for tool args. Sorts object keys recursively so
 * `{a:1, b:2}` and `{b:2, a:1}` hash identically.
 */
function stableJSON(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(stableJSON).join(",")}]`;
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const parts = keys.map((k) => `${JSON.stringify(k)}:${stableJSON((value as Record<string, unknown>)[k])}`);
  return `{${parts.join(",")}}`;
}

export function hashArgs(toolName: string, args: unknown): string {
  return createHash("sha256").update(toolName).update(" ").update(stableJSON(args)).digest("hex");
}

// --- cache ---------------------------------------------------------------

export class ToolCache {
  private readonly map = new Map<string, ToolResult>();

  get(hash: string): ToolResult | null {
    return this.map.get(hash) ?? null;
  }

  set(hash: string, result: ToolResult): void {
    this.map.set(hash, result);
  }

  /** Pre-populate from a recorded event log's tool.responded events. */
  static fromEvents(events: readonly Event[]): ToolCache {
    const cache = new ToolCache();
    for (const e of events) {
      if (e.type !== "tool.responded") continue;
      const hash = e.payload.args_hash as string | undefined;
      if (hash === undefined) continue;
      if (e.payload.error !== undefined && e.payload.error !== null) continue;
      cache.set(hash, {
        output: e.payload.output,
        costUsd: (e.payload.cost_usd as number | undefined) ?? 0,
      });
    }
    return cache;
  }
}

// --- dispatch ------------------------------------------------------------

export interface ToolDispatchOptions {
  graph: Graph;
  tool: Tool;
  args: unknown;
  behaviorName: string;
  triggeringEvent: Event;
  cache: ToolCache | null;
  budget: Budget;
  frameId: string | null;
  clockNow: () => string;
  eventId: () => string;
}

export interface ToolDispatchResult {
  result: ToolResult;
  requested: Event;
  responded: Event;
  fromCache: boolean;
}

export async function dispatchTool(opts: ToolDispatchOptions): Promise<ToolDispatchResult> {
  const argsHash = hashArgs(opts.tool.name, opts.args);
  const cached = opts.tool.deterministic ? opts.cache?.get(argsHash) ?? null : null;

  const requested = opts.graph.emit(
    makeEvent({
      id: opts.eventId(),
      type: "tool.requested",
      payload: {
        behavior: opts.behaviorName,
        tool: opts.tool.name,
        args: opts.args,
        args_hash: argsHash,
        deterministic: opts.tool.deterministic,
        cache_hit: cached !== null,
      },
      actor: opts.behaviorName,
      frameId: opts.frameId,
      causedBy: opts.triggeringEvent.id,
      timestamp: opts.clockNow(),
    }),
  );

  const ctx: ToolContext = {
    behaviorName: opts.behaviorName,
    requestEventId: requested.id,
  };

  let result: ToolResult;
  let fromCache = false;
  const t0 = performance.now();
  if (cached !== null) {
    result = cached;
    fromCache = true;
  } else {
    opts.budget.consume("maxToolCalls");
    try {
      result = await opts.tool.handler(opts.args, ctx);
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      const error: ToolError = { reason: e.message };
      result = { error };
    }
    if (result.error === undefined && opts.tool.deterministic && opts.cache !== null) {
      opts.cache.set(argsHash, result);
    }
    if (result.costUsd !== undefined && result.costUsd > 0) {
      opts.budget.addCost(result.costUsd);
    }
  }
  const latencySeconds = (performance.now() - t0) / 1000;

  const respondedPayload: Record<string, unknown> = {
    behavior: opts.behaviorName,
    tool: opts.tool.name,
    args_hash: argsHash,
    latency_seconds: latencySeconds,
    cache_hit: fromCache,
  };
  if (result.error !== undefined) {
    respondedPayload.error = result.error;
  } else {
    respondedPayload.output = result.output;
    if (result.costUsd !== undefined) respondedPayload.cost_usd = result.costUsd;
  }

  const responded = opts.graph.emit(
    makeEvent({
      id: opts.eventId(),
      type: "tool.responded",
      payload: respondedPayload,
      actor: opts.behaviorName,
      frameId: opts.frameId,
      causedBy: requested.id,
      timestamp: opts.clockNow(),
    }),
  );

  return { result, requested, responded, fromCache };
}
