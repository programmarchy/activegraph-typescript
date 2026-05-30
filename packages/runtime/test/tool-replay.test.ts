// Tool cache + replay — a recorded run's deterministic tool calls
// can be served from cache on a subsequent run / fork, avoiding the
// tool handler entirely.

import { beforeEach, describe, expect, it } from "vitest";

import { FrozenClock, Graph, IDGen } from "@activegraph/core";
import { InMemoryEventStore } from "@activegraph/store-memory";
import { clearToolRegistry, defineTool } from "@activegraph/tools";

import {
  Runtime,
  ToolCache,
  clearRegistry,
  defineBehavior,
} from "../src/index.js";

function newGraph(): Graph {
  return new Graph({ ids: new IDGen(), clock: new FrozenClock() });
}

describe("Tool cache + replay", () => {
  beforeEach(() => {
    clearRegistry();
    clearToolRegistry();
  });

  it("ToolCache.fromEvents reconstructs cache from a recorded run", async () => {
    let calls = 0;
    defineTool({
      name: "echo",
      deterministic: true,
      handler: async (args: { msg: string }) => {
        calls += 1;
        return { output: `echo:${args.msg}` };
      },
    });
    defineBehavior({
      name: "caller",
      on: ["goal.created"],
      handler: async (_e, _g, ctx) => {
        await ctx.callTool("echo", { msg: "hi" });
      },
    });

    const g1 = newGraph();
    const store = new InMemoryEventStore(g1.runId);
    g1.attachStore(store);
    await new Runtime(g1).runGoal("first");
    expect(calls).toBe(1);

    // Build cache from the recorded events, replay into a fresh graph
    // continuing the run. Identical args → cache hit, tool handler
    // never re-executes.
    const cache = ToolCache.fromEvents(g1.events);
    const replayed = await Runtime.load(store);
    // Continue with a second call that has identical args.
    calls = 0;
    const r = new Runtime(replayed.graph, { toolCache: cache });
    await r.runGoal("second");
    expect(calls).toBe(0);

    // The new tool.responded event records cache_hit=true.
    const newToolResp = r.graph.events
      .filter((e) => e.type === "tool.responded")
      .at(-1)!;
    expect(newToolResp.payload.cache_hit).toBe(true);
  });

  it("non-deterministic tools always re-invoke even with a cache present", async () => {
    let calls = 0;
    defineTool({
      name: "rand",
      deterministic: false,
      handler: async () => {
        calls += 1;
        return { output: Math.random() };
      },
    });
    defineBehavior({
      name: "caller",
      on: ["goal.created"],
      handler: async (_e, _g, ctx) => {
        await ctx.callTool("rand", { same: true });
      },
    });

    const g = newGraph();
    const r = new Runtime(g, { toolCache: new ToolCache() });
    await r.runGoal("first");
    await r.runGoal("second");
    expect(calls).toBe(2);
  });
});
