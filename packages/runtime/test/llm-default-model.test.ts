// Model resolution: behavior.model > provider.defaultModel.

import { beforeEach, describe, expect, it } from "vitest";

import { FrozenClock, Graph, IDGen } from "@activegraph/core";
import type { LLMProvider, LLMRequest } from "@activegraph/llm";

import {
  Runtime,
  clearRegistry,
  defineLLMBehavior,
} from "../src/index.js";

function newGraph(): Graph {
  return new Graph({ ids: new IDGen(), clock: new FrozenClock() });
}

function recordingProvider(defaultModel: string): {
  provider: LLMProvider;
  lastModel: () => string | null;
} {
  let last: string | null = null;
  return {
    provider: {
      name: "rec",
      defaultModel,
      async complete(req: LLMRequest) {
        last = req.model;
        return {
          text: "ok",
          inputTokens: 1,
          outputTokens: 1,
          costUsd: 0,
          latencySeconds: 0,
        };
      },
      countTokens: () => 1,
    },
    lastModel: () => last,
  };
}

describe("LLM model resolution", () => {
  beforeEach(() => clearRegistry());

  it("falls back to provider.defaultModel when behavior.model is null", async () => {
    defineLLMBehavior({ name: "x", on: ["goal.created"], handler: () => {} });
    const r = recordingProvider("provider-default");
    const g = newGraph();
    await new Runtime(g, { llmProvider: r.provider }).runGoal("test");
    expect(r.lastModel()).toBe("provider-default");
  });

  it("uses behavior.model when set, overriding provider default", async () => {
    defineLLMBehavior({
      name: "x",
      on: ["goal.created"],
      model: "behavior-model",
      handler: () => {},
    });
    const r = recordingProvider("provider-default");
    const g = newGraph();
    await new Runtime(g, { llmProvider: r.provider }).runGoal("test");
    expect(r.lastModel()).toBe("behavior-model");
  });

  it("stamps the resolved model into llm.requested payload", async () => {
    defineLLMBehavior({
      name: "x",
      on: ["goal.created"],
      model: "claude-opus-99",
      handler: () => {},
    });
    const r = recordingProvider("ignored");
    const g = newGraph();
    await new Runtime(g, { llmProvider: r.provider }).runGoal("test");
    const llmReq = g.events.find((e) => e.type === "llm.requested")!;
    expect(llmReq.payload.model).toBe("claude-opus-99");
  });
});
