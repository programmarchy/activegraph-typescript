// Tool trace snapshot — pins the trace text for a run with tool calls.

import { beforeEach, describe, expect, it } from "vitest";

import { FrozenClock, Graph, IDGen, Trace } from "@activegraph/core";
import { clearToolRegistry, defineTool } from "@activegraph/tools";

import {
  Runtime,
  clearRegistry,
  defineBehavior,
} from "../src/index.js";

describe("Tool trace snapshot", () => {
  beforeEach(() => {
    clearRegistry();
    clearToolRegistry();
  });

  it("renders tool.requested + tool.responded with tool name + args_hash", async () => {
    defineTool({
      name: "fetch",
      deterministic: true,
      handler: async (args: { url: string }) => ({ output: `body:${args.url}` }),
    });

    defineBehavior({
      name: "puller",
      on: ["goal.created"],
      handler: async (_e, _g, ctx) => {
        await ctx.callTool("fetch", { url: "https://example.com" });
      },
    });

    const g = new Graph({ ids: new IDGen(), clock: new FrozenClock() });
    await new Runtime(g).runGoal("pull");
    const text = `${new Trace(g).lines().join("\n")}\n`;
    await expect(text).toMatchFileSnapshot("./snapshots/tool-trace.txt");
  });
});
