// Budget enforcement on LLM calls — maxLlmCalls + maxCostUsd.

import { beforeEach, describe, expect, it } from "vitest";

import { FrozenClock, Graph, IDGen } from "@activegraph/core";
import type { LLMProvider, LLMResponse } from "@activegraph/llm";

import { Runtime, clearRegistry, defineLLMBehavior } from "../src/index.js";

function newGraph(): Graph {
  return new Graph({ ids: new IDGen(), clock: new FrozenClock() });
}

function fixedProvider(response: LLMResponse): LLMProvider {
  return {
    name: "fixed",
    defaultModel: "m",
    complete: async () => response,
    countTokens: () => 1,
  };
}

describe("LLM budget enforcement", () => {
  beforeEach(() => clearRegistry());

  it("consumes maxLlmCalls per provider call", async () => {
    defineLLMBehavior({
      name: "x",
      on: ["goal.created"],
      handler: () => {},
    });
    const g = newGraph();
    const r = new Runtime(g, {
      llmProvider: fixedProvider({
        text: "ok",
        inputTokens: 1,
        outputTokens: 1,
        costUsd: 0,
        latencySeconds: 0,
      }),
      budget: { maxLlmCalls: 10 },
    });
    await r.runGoal("test");
    expect(r.budget.used.maxLlmCalls).toBe(1);
  });

  it("accumulates cost across LLM calls", async () => {
    defineLLMBehavior({
      name: "x",
      on: ["goal.created", "ping"],
      handler: (_e, _g, ctx) => {
        ctx.emit("ping", {});
      },
    });
    const g = newGraph();
    const r = new Runtime(g, {
      llmProvider: fixedProvider({
        text: "ok",
        inputTokens: 1,
        outputTokens: 1,
        costUsd: 0.005,
        latencySeconds: 0,
      }),
      budget: { maxEvents: 6 },
    });
    await r.runGoal("test");
    // Each non-meta event triggers the behavior, which makes 1 LLM
    // call. Across maxEvents=6, several calls happen.
    expect(r.budget.used.maxLlmCalls).toBeGreaterThan(1);
    expect(r.budget.snapshot().costUsedUsd).toBeCloseTo(r.budget.used.maxLlmCalls * 0.005, 5);
  });

  it("respects maxCostUsd as a ceiling check (sets the budget limit)", () => {
    const g = newGraph();
    const r = new Runtime(g, { budget: { maxCostUsd: 0.01 } });
    expect(r.budget.snapshot().costLimitUsd).toBe(0.01);
  });
});
