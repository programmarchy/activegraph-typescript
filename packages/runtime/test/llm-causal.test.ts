// Causal chain renders the LLM round-trip when an object was created
// inside an @llmBehavior handler (the provenance carries
// llm_request_event_id).

import { beforeEach, describe, expect, it } from "vitest";

import { FrozenClock, Graph, IDGen, causalChain } from "@activegraph/core";
import type { LLMProvider } from "@activegraph/llm";

import {
  Runtime,
  clearRegistry,
  defineLLMBehavior,
} from "../src/index.js";

function newGraph(): Graph {
  return new Graph({ ids: new IDGen(), clock: new FrozenClock() });
}

const fixedProvider: LLMProvider = {
  name: "fixed",
  defaultModel: "m",
  async complete() {
    return {
      text: '{"text": "fixed", "confidence": 0.9}',
      inputTokens: 5,
      outputTokens: 4,
      costUsd: 0.001,
      latencySeconds: 0.05,
    };
  },
  countTokens: () => 5,
};

describe("Causal chain across LLM boundary", () => {
  beforeEach(() => clearRegistry());

  it("renders llm.requested + llm.responded in the chain when llm_request_event_id is threaded", async () => {
    defineLLMBehavior({
      name: "extractor",
      on: ["goal.created"],
      outputSchema: { parse: (v: unknown) => v as { text: string; confidence: number } },
      handler: (event, graph, ctx, output) => {
        // Find the LLM request emitted on this turn.
        const llmReq = graph.events.filter((e) => e.type === "llm.requested").at(-1)!;
        graph.addObject(
          "claim",
          output as Record<string, unknown>,
          {
            actor: "extractor",
            causedBy: event.id,
            llmRequestEventId: llmReq.id,
          },
        );
      },
    });

    const g = newGraph();
    await new Runtime(g, { llmProvider: fixedProvider }).runGoal("extract");

    const claim = g.allObjects().find((o) => o.type === "claim")!;
    const chain = causalChain(g, claim.id);
    expect(chain).toContain(claim.id);
    expect(chain).toContain("llm.requested");
    expect(chain).toContain("llm.responded");
    expect(chain).toContain("model=m");
    expect(chain).toContain("goal.created");
  });

  it("renders cost=$X.XXX on the llm.responded line", async () => {
    defineLLMBehavior({
      name: "extractor",
      on: ["goal.created"],
      handler: (event, graph) => {
        const llmReq = graph.events.filter((e) => e.type === "llm.requested").at(-1)!;
        graph.addObject(
          "result",
          {},
          {
            actor: "extractor",
            causedBy: event.id,
            llmRequestEventId: llmReq.id,
          },
        );
      },
    });

    const g = newGraph();
    await new Runtime(g, { llmProvider: fixedProvider }).runGoal("extract");
    const obj = g.allObjects().find((o) => o.type === "result")!;
    const chain = causalChain(g, obj.id);
    expect(chain).toMatch(/cost=\$0\.001/);
  });
});
