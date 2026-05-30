// LLM behavior failure paths — provider throws, schema validation
// fails, output parse fails — all become behavior.failed events
// rather than thrown exceptions.

import { beforeEach, describe, expect, it } from "vitest";

import { FrozenClock, Graph, IDGen } from "@activegraph/core";
import type { LLMProvider, LLMResponse } from "@activegraph/llm";

import { Runtime, clearRegistry, defineLLMBehavior } from "../src/index.js";

function newGraph(): Graph {
  return new Graph({ ids: new IDGen(), clock: new FrozenClock() });
}

function stubProvider(complete: () => Promise<LLMResponse>): LLMProvider {
  return {
    name: "stub",
    defaultModel: "stub-model",
    complete,
    countTokens: () => 1,
  };
}

describe("LLM failure handling", () => {
  beforeEach(() => clearRegistry());

  it("provider exception becomes behavior.failed (loop continues)", async () => {
    defineLLMBehavior({
      name: "thrower",
      on: ["goal.created"],
      handler: () => {},
    });

    const g = newGraph();
    const provider = stubProvider(async () => {
      throw new Error("provider down");
    });
    await new Runtime(g, { llmProvider: provider }).runGoal("test");

    const failed = g.events.find((e) => e.type === "behavior.failed")!;
    expect(failed).toBeDefined();
    expect(failed.payload.behavior).toBe("thrower");
    expect(String(failed.payload.message)).toContain("provider down");
  });

  it("output schema mismatch becomes behavior.failed", async () => {
    const Schema = {
      parse(input: unknown): { ok: true } {
        if (typeof input !== "object" || input === null) throw new Error("not object");
        if ((input as { ok?: boolean }).ok !== true) throw new Error("ok must be true");
        return input as { ok: true };
      },
    };
    defineLLMBehavior({
      name: "expects-ok",
      on: ["goal.created"],
      outputSchema: Schema,
      handler: () => {},
    });

    const g = newGraph();
    const provider = stubProvider(async () => ({
      text: '{"ok": false}',
      inputTokens: 1,
      outputTokens: 1,
      costUsd: 0,
      latencySeconds: 0,
    }));
    await new Runtime(g, { llmProvider: provider }).runGoal("test");

    const failed = g.events.find((e) => e.type === "behavior.failed")!;
    expect(failed).toBeDefined();
    expect(String(failed.payload.message)).toContain("ok must be true");
  });

  it("invalid JSON text + schema → behavior.failed", async () => {
    const Schema = { parse: (v: unknown) => v as Record<string, unknown> };
    defineLLMBehavior({
      name: "expects-json",
      on: ["goal.created"],
      outputSchema: Schema,
      handler: () => {},
    });

    const g = newGraph();
    const provider = stubProvider(async () => ({
      text: "not actually json",
      inputTokens: 1,
      outputTokens: 1,
      costUsd: 0,
      latencySeconds: 0,
    }));
    await new Runtime(g, { llmProvider: provider }).runGoal("test");

    const failed = g.events.find((e) => e.type === "behavior.failed")!;
    expect(failed).toBeDefined();
  });
});
