// Diligence pack + tools integration — wire the pack into a Graph,
// register a tool, have an LLM behavior call the tool, validate that
// objects added via addObject pass through the pack's schema gate.

import { beforeEach, describe, expect, it } from "vitest";

import { FrozenClock, Graph, IDGen } from "@activegraph/core";
import { type LLMProvider, type LLMResponse } from "@activegraph/llm";
import { PackSchemaViolation, loadPack } from "@activegraph/packs";
import { clearToolRegistry, defineTool } from "@activegraph/tools";

import { diligencePack } from "@activegraph/pack-diligence";

import {
  Runtime,
  clearRegistry,
  defineBehavior,
  defineLLMBehavior,
} from "../src/index.js";

function newGraph(): Graph {
  return new Graph({ ids: new IDGen(), clock: new FrozenClock() });
}

describe("Diligence pack with tools", () => {
  beforeEach(() => {
    clearRegistry();
    clearToolRegistry();
  });

  it("addObject('claim', ...) validates against the pack's ClaimSchema", () => {
    const g = newGraph();
    loadPack(g, diligencePack);

    expect(() =>
      g.addObject("claim", {
        text: "Revenue is growing.",
        confidence: 0.9,
        company_id: "company#0",
      }),
    ).not.toThrow();

    // Missing required field (text).
    expect(() =>
      g.addObject("claim", {
        confidence: 0.5,
        company_id: "company#0",
      }),
    ).toThrow(PackSchemaViolation);
  });

  it("tool + LLM behavior + pack schema work together in one run", async () => {
    defineTool({
      name: "fetch",
      handler: async (args: { url: string }) => ({ output: `body:${args.url}` }),
    });

    const stubProvider: LLMProvider = {
      name: "stub",
      defaultModel: "m",
      async complete(): Promise<LLMResponse> {
        return {
          text: '{"text": "Revenue is up 42%.", "confidence": 0.95, "company_id": "company#0"}',
          inputTokens: 1,
          outputTokens: 1,
          costUsd: 0,
          latencySeconds: 0,
        };
      },
      countTokens: () => 1,
    };

    const ClaimSchema = {
      parse(input: unknown): { text: string; confidence: number; company_id: string } {
        if (typeof input !== "object" || input === null) throw new Error("not object");
        return input as { text: string; confidence: number; company_id: string };
      },
    };

    defineLLMBehavior({
      name: "extractor",
      on: ["object.created"],
      where: { "object.type": "document" },
      outputSchema: ClaimSchema,
      handler: async (_e, graph, ctx, output) => {
        await ctx.callTool("fetch", { url: "x" });
        graph.addObject("claim", output as Record<string, unknown>);
      },
    });

    defineBehavior({
      name: "seed",
      on: ["goal.created"],
      handler: (_e, graph) => {
        graph.addObject("document", {
          title: "FY24",
          url: "x",
          company_id: "company#0",
        });
      },
    });

    const g = newGraph();
    loadPack(g, diligencePack);
    await new Runtime(g, { llmProvider: stubProvider }).runGoal("research");

    expect(g.allObjects().filter((o) => o.type === "claim")).toHaveLength(1);
    expect(g.events.filter((e) => e.type === "tool.requested")).toHaveLength(1);
    expect(g.events.filter((e) => e.type === "llm.requested")).toHaveLength(1);
  });
});
