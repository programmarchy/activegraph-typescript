// Tool dispatch lifecycle — tool.requested / tool.responded events,
// args_hash, cache for deterministic tools, error path.

import { beforeEach, describe, expect, it } from "vitest";

import { FrozenClock, Graph, IDGen } from "@activegraph/core";
import { clearToolRegistry, defineTool, UnknownToolError } from "@activegraph/tools";

import {
  Runtime,
  ToolCache,
  clearRegistry,
  defineBehavior,
  hashArgs,
} from "../src/index.js";

function newGraph(): Graph {
  return new Graph({ ids: new IDGen(), clock: new FrozenClock() });
}

describe("hashArgs", () => {
  it("produces a stable hash regardless of object key order", () => {
    expect(hashArgs("t", { a: 1, b: 2 })).toBe(hashArgs("t", { b: 2, a: 1 }));
  });

  it("differs for different tool names", () => {
    expect(hashArgs("a", { x: 1 })).not.toBe(hashArgs("b", { x: 1 }));
  });

  it("differs for different args", () => {
    expect(hashArgs("t", { x: 1 })).not.toBe(hashArgs("t", { x: 2 }));
  });
});

describe("ctx.callTool", () => {
  beforeEach(() => {
    clearRegistry();
    clearToolRegistry();
  });

  it("emits tool.requested + tool.responded and returns the result", async () => {
    defineTool({
      name: "echo",
      handler: async (args: { msg: string }) => ({ output: `echo:${args.msg}` }),
    });
    defineBehavior({
      name: "caller",
      on: ["goal.created"],
      handler: async (_e, _g, ctx) => {
        const r = await ctx.callTool<{ msg: string }, string>("echo", { msg: "hi" });
        expect(r.output).toBe("echo:hi");
      },
    });

    const g = newGraph();
    await new Runtime(g).runGoal("test");

    const types = g.events.map((e) => e.type);
    expect(types).toContain("tool.requested");
    expect(types).toContain("tool.responded");
    const responded = g.events.find((e) => e.type === "tool.responded")!;
    expect(responded.payload.tool).toBe("echo");
    expect(responded.payload.output).toBe("echo:hi");
  });

  it("caches deterministic tools across identical args", async () => {
    let calls = 0;
    defineTool({
      name: "count",
      deterministic: true,
      handler: async () => {
        calls += 1;
        return { output: calls };
      },
    });
    defineBehavior({
      name: "doubleCaller",
      on: ["goal.created"],
      handler: async (_e, _g, ctx) => {
        await ctx.callTool("count", { x: 1 });
        await ctx.callTool("count", { x: 1 });
      },
    });

    const g = newGraph();
    const cache = new ToolCache();
    await new Runtime(g, { toolCache: cache }).runGoal("test");

    expect(calls).toBe(1);
    const cacheMap = (cache as unknown as { map: Map<string, unknown> }).map;
    expect(cacheMap.size).toBe(1);

    const responded = g.events.filter((e) => e.type === "tool.responded");
    expect(responded).toHaveLength(2);
    expect(responded[1]!.payload.cache_hit).toBe(true);
  });

  it("does NOT cache non-deterministic tools", async () => {
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
      name: "twoRand",
      on: ["goal.created"],
      handler: async (_e, _g, ctx) => {
        await ctx.callTool("rand", { x: 1 });
        await ctx.callTool("rand", { x: 1 });
      },
    });

    const g = newGraph();
    await new Runtime(g, { toolCache: new ToolCache() }).runGoal("test");
    expect(calls).toBe(2);
  });

  it("tool exceptions surface in tool.responded as a structured error", async () => {
    defineTool({
      name: "broken",
      handler: async () => {
        throw new Error("boom");
      },
    });
    defineBehavior({
      name: "caller",
      on: ["goal.created"],
      handler: async (_e, _g, ctx) => {
        const r = await ctx.callTool("broken", {});
        expect(r.error?.reason).toBe("boom");
      },
    });

    const g = newGraph();
    await new Runtime(g).runGoal("test");
    const responded = g.events.find((e) => e.type === "tool.responded")!;
    const err = responded.payload.error as { reason: string };
    expect(err.reason).toBe("boom");
  });

  it("throws UnknownToolError for an unregistered tool name", async () => {
    let caught: unknown = null;
    defineBehavior({
      name: "caller",
      on: ["goal.created"],
      handler: async (_e, _g, ctx) => {
        try {
          await ctx.callTool("nope", {});
        } catch (err) {
          caught = err;
        }
      },
    });

    const g = newGraph();
    await new Runtime(g).runGoal("test");
    expect(caught).toBeInstanceOf(UnknownToolError);
  });
});

describe("ToolCache.fromEvents", () => {
  beforeEach(() => {
    clearRegistry();
    clearToolRegistry();
  });

  it("populates from recorded tool.responded events", async () => {
    defineTool({
      name: "echo",
      deterministic: true,
      handler: async (args: { msg: string }) => ({ output: `echo:${args.msg}` }),
    });
    defineBehavior({
      name: "caller",
      on: ["goal.created"],
      handler: async (_e, _g, ctx) => {
        await ctx.callTool("echo", { msg: "hi" });
      },
    });

    const g = newGraph();
    await new Runtime(g).runGoal("test");

    const cache = ToolCache.fromEvents(g.events);
    const cacheMap = (cache as unknown as { map: Map<string, unknown> }).map;
    expect(cacheMap.size).toBe(1);
  });
});
