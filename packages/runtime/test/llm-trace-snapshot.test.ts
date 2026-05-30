// LLM trace snapshot — pins the trace text for a run that includes
// llm.requested / llm.responded events with a recorded provider.

import { beforeEach, describe, expect, it } from "vitest";

import { FrozenClock, Graph, IDGen, Trace } from "@activegraph/core";
import { RecordedLLMProvider, type RecordedExchange } from "@activegraph/llm";

import {
  Runtime,
  clearRegistry,
  defineLLMBehavior,
} from "../src/index.js";

describe("LLM trace snapshot", () => {
  beforeEach(() => clearRegistry());

  it("renders llm.requested + llm.responded with cost and tokens", async () => {
    defineLLMBehavior({
      name: "summarizer",
      on: ["goal.created"],
      handler: () => {},
    });

    const exchanges: RecordedExchange[] = [
      {
        request: { model: "claude-sonnet-4-6", messages: [] },
        response: {
          text: "this is a summary",
          inputTokens: 120,
          outputTokens: 14,
          costUsd: 0.0021,
          latencySeconds: 0.34,
        },
      },
    ];

    const g = new Graph({ ids: new IDGen(), clock: new FrozenClock() });
    await new Runtime(g, { llmProvider: new RecordedLLMProvider(exchanges) }).runGoal(
      "summarize the report",
    );
    const text = `${new Trace(g).lines().join("\n")}\n`;
    await expect(text).toMatchFileSnapshot("./snapshots/llm-trace.txt");
  });
});
