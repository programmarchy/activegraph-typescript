// The killer demo: extract a structured Claim from text via outputSchema.
// End-to-end LLM behavior dispatch + Standard Schema validation +
// addObject.

import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { FrozenClock, Graph, IDGen } from "@activegraph/core";
import { RecordedLLMProvider, type RecordedExchange } from "@activegraph/llm";

import {
  Runtime,
  clearRegistry,
  defineLLMBehavior,
} from "../src/index.js";

function newGraph(): Graph {
  return new Graph({ ids: new IDGen(), clock: new FrozenClock() });
}

describe("LLM claim extraction (the killer demo)", () => {
  beforeEach(() => clearRegistry());

  it("extracts a structured claim from a document and adds it to the graph", async () => {
    const ClaimSchema = z.object({
      text: z.string(),
      confidence: z.number().min(0).max(1),
    });

    type Claim = z.infer<typeof ClaimSchema>;

    defineLLMBehavior({
      name: "claim-extractor",
      on: ["object.created"],
      where: { "object.type": "document" },
      outputSchema: ClaimSchema,
      handler: (event, graph, _ctx, output: Claim) => {
        const doc = event.payload.object as Record<string, unknown>;
        graph.addObject("claim", {
          ...output,
          source_document_id: doc.id,
        });
      },
    });

    const exchanges: RecordedExchange[] = [
      {
        request: { model: "m", messages: [] },
        response: {
          text: '{"text": "Q4 revenue up 42%.", "confidence": 0.92}',
          inputTokens: 50,
          outputTokens: 20,
          costUsd: 0.005,
          latencySeconds: 0.5,
        },
      },
    ];

    const g = newGraph();
    const r = new Runtime(g, { llmProvider: new RecordedLLMProvider(exchanges) });
    g.addObject("document", { title: "FY24 Q4", url: "x", text: "..." });
    await r.runUntilIdle();

    const claims = g.allObjects().filter((o) => o.type === "claim");
    expect(claims).toHaveLength(1);
    expect(claims[0]!.data.text).toBe("Q4 revenue up 42%.");
    expect(claims[0]!.data.confidence).toBe(0.92);
    expect(claims[0]!.data.source_document_id).toBe("document#1");
  });
});
