// Deterministic LLM behavior — same prompt hash → same response from
// cache; behavior with deterministic:true is what's safe to fork
// without re-billing.

import { beforeEach, describe, expect, it } from "vitest";

import { FrozenClock, Graph, IDGen } from "@activegraph/core";
import type { LLMProvider, LLMResponse } from "@activegraph/llm";

import {
  LLMCache,
  Runtime,
  clearRegistry,
  defineLLMBehavior,
} from "../src/index.js";

function newGraph(): Graph {
  return new Graph({ ids: new IDGen(), clock: new FrozenClock() });
}

function counterProvider(response: LLMResponse): { provider: LLMProvider; calls: () => number } {
  let n = 0;
  const provider: LLMProvider = {
    name: "counter",
    defaultModel: "m",
    async complete(): Promise<LLMResponse> {
      n += 1;
      return response;
    },
    countTokens: () => 1,
  };
  return { provider, calls: () => n };
}

describe("LLM determinism + cache", () => {
  beforeEach(() => clearRegistry());

  it("identical prompts hit the cache", async () => {
    const { provider, calls } = counterProvider({
      text: "fixed",
      inputTokens: 1,
      outputTokens: 1,
      costUsd: 0.01,
      latencySeconds: 0,
    });
    defineLLMBehavior({ name: "x", on: ["goal.created"], handler: () => {} });

    const cache = new LLMCache();

    // First run: cache miss, provider called.
    const g1 = newGraph();
    await new Runtime(g1, { llmProvider: provider, llmCache: cache }).runGoal("same");
    expect(calls()).toBe(1);

    // Second run with the SAME goal text + same view → same prompt
    // hash → cache hit, provider not called again.
    const g2 = new Graph({
      ids: new IDGen(),
      clock: new FrozenClock(),
      runId: g1.runId, // doesn't affect prompt hash but keeps the run id stable
    });
    await new Runtime(g2, { llmProvider: provider, llmCache: cache }).runGoal("same");
    expect(calls()).toBe(1);

    // Verify cache_hit lands in the trace.
    const llmResp = g2.events.find((e) => e.type === "llm.responded")!;
    expect(llmResp.payload.cache_hit).toBe(true);
  });

  it("LLMCache.fromEvents reconstructs cache after a fresh load", async () => {
    const { provider } = counterProvider({
      text: "cached-result",
      inputTokens: 1,
      outputTokens: 1,
      costUsd: 0.001,
      latencySeconds: 0,
    });
    defineLLMBehavior({ name: "x", on: ["goal.created"], handler: () => {} });

    const g = newGraph();
    await new Runtime(g, { llmProvider: provider }).runGoal("test");

    const reconstructed = LLMCache.fromEvents(g.events);
    const cacheMap = (reconstructed as unknown as { map: Map<string, unknown> }).map;
    expect(cacheMap.size).toBe(1);
  });

  it("deterministic:true is the default-off marker (passes through provider call)", async () => {
    let receivedDeterministic: boolean | undefined;
    const provider: LLMProvider = {
      name: "snoop",
      defaultModel: "m",
      async complete(req) {
        receivedDeterministic = req.deterministic;
        return { text: "", inputTokens: 0, outputTokens: 0, costUsd: 0, latencySeconds: 0 };
      },
      countTokens: () => 1,
    };
    defineLLMBehavior({
      name: "x",
      on: ["goal.created"],
      deterministic: true,
      handler: () => {},
    });

    const g = newGraph();
    await new Runtime(g, { llmProvider: provider }).runGoal("test");
    expect(receivedDeterministic).toBe(true);
  });
});
