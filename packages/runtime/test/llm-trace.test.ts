// LLM trace formatting — llm.requested / llm.responded lines render
// the canonical format with model, tokens, cost, latency, cache_hit,
// and turn_index when in a tool turn loop.

import { beforeEach, describe, expect, it } from "vitest";

import { FrozenClock, Graph, IDGen, formatEvent } from "@activegraph/core";
import type { LLMProvider } from "@activegraph/llm";

import { Runtime, clearRegistry, defineLLMBehavior } from "../src/index.js";

function newGraph(): Graph {
  return new Graph({ ids: new IDGen(), clock: new FrozenClock() });
}

const fixed: LLMProvider = {
  name: "f",
  defaultModel: "claude-sonnet-4-6",
  async complete() {
    return {
      text: "ok",
      inputTokens: 100,
      outputTokens: 30,
      costUsd: 0.0015,
      latencySeconds: 0.42,
    };
  },
  countTokens: () => 100,
};

describe("LLM trace formatting", () => {
  beforeEach(() => clearRegistry());

  it("llm.requested line includes model + estimated tokens", async () => {
    defineLLMBehavior({ name: "x", on: ["goal.created"], handler: () => {} });
    const g = newGraph();
    await new Runtime(g, { llmProvider: fixed }).runGoal("test");

    const req = g.events.find((e) => e.type === "llm.requested")!;
    const line = formatEvent(req);
    expect(line).toMatch(/^\[llm\.requested\]/);
    expect(line).toContain("model=claude-sonnet-4-6");
    expect(line).toContain("tokens_in~100");
  });

  it("llm.responded line includes tokens + cost + latency", async () => {
    defineLLMBehavior({ name: "x", on: ["goal.created"], handler: () => {} });
    const g = newGraph();
    await new Runtime(g, { llmProvider: fixed }).runGoal("test");

    const resp = g.events.find((e) => e.type === "llm.responded")!;
    const line = formatEvent(resp);
    expect(line).toMatch(/^\[llm\.responded\]/);
    expect(line).toContain("tokens_in=100");
    expect(line).toContain("tokens_out=30");
    expect(line).toContain("cost=$0.002"); // toFixed(3) rounds .0015 → .002
    expect(line).toContain("latency=0.4s");
  });

  it("cache_hit line drops cost/latency segments", async () => {
    const cachedResp = {
      text: "cached-text",
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0.001,
      latencySeconds: 0.5,
      cache_hit: true,
    };
    const fakeEvent = {
      id: "evt_999",
      type: "llm.responded",
      payload: { behavior: "x", ...cachedResp },
      actor: "runtime",
      frameId: null,
      causedBy: "evt_998",
      timestamp: "t",
    };
    const line = formatEvent(fakeEvent);
    expect(line).toContain("cache_hit=true");
    expect(line).not.toContain("cost=");
    expect(line).not.toContain("latency=");
  });
});
