// LLM behavior dispatch — prompt assembly, cache, provider call, output
// parsing, llm.requested/responded events.

import { beforeEach, describe, expect, it } from "vitest";

import { FrozenClock, Graph, IDGen, View } from "@activegraph/core";
import {
  type LLMProvider,
  type LLMRequest,
  type LLMResponse,
  type RecordedExchange,
  RecordedLLMProvider,
} from "@activegraph/llm";
import { InMemoryEventStore } from "@activegraph/store-memory";

import {
  LLMCache,
  Runtime,
  assemblePrompt,
  clearRegistry,
  defineLLMBehavior,
  extractJSON,
  parseOutput,
} from "../src/index.js";

function newGraph(): Graph {
  return new Graph({ ids: new IDGen(), clock: new FrozenClock() });
}

describe("extractJSON", () => {
  it("strips ```json fences", () => {
    expect(extractJSON('```json\n{"x":1}\n```')).toBe('{"x":1}');
  });
  it("strips bare ``` fences", () => {
    expect(extractJSON('```\n{"x":1}\n```')).toBe('{"x":1}');
  });
  it("returns trimmed text when no fences", () => {
    expect(extractJSON('  {"x":1}  ')).toBe('{"x":1}');
  });
});

describe("parseOutput", () => {
  it("returns raw text when schema is null", async () => {
    expect(await parseOutput("hello", null)).toBe("hello");
  });

  it("validates via Zod-style .parse()", async () => {
    const schema = {
      parse(input: unknown) {
        const o = input as { name: string };
        if (typeof o?.name !== "string") throw new Error("name required");
        return o;
      },
    };
    const out = await parseOutput<{ name: string }>('{"name": "X"}', schema);
    expect(out).toEqual({ name: "X" });
  });

  it("validates via Standard Schema ~standard.validate", async () => {
    const schema = {
      "~standard": {
        validate(input: unknown) {
          const o = input as { n: number };
          if (typeof o?.n !== "number") return { issues: ["n required"] };
          return { value: o };
        },
      },
    };
    const out = await parseOutput<{ n: number }>('{"n": 42}', schema);
    expect(out).toEqual({ n: 42 });
  });
});

describe("assemblePrompt", () => {
  beforeEach(() => clearRegistry());

  it("produces a stable hash for identical inputs", () => {
    const behavior = defineLLMBehavior({
      name: "x",
      handler: () => {},
    });
    const g = newGraph();
    g.addObject("task", { title: "A" });
    const event = g.events[0];
    if (event === undefined) throw new Error("expected object.created event");
    const a = assemblePrompt({
      behavior,
      event,
      view: new View([], [], []),
      defaultModel: "test-model",
    });
    const b = assemblePrompt({
      behavior,
      event,
      view: new View([], [], []),
      defaultModel: "test-model",
    });
    expect(a.hash).toBe(b.hash);
  });
});

describe("Runtime LLM dispatch", () => {
  beforeEach(() => clearRegistry());

  it("emits llm.requested + llm.responded around the provider call", async () => {
    let received: unknown = null;
    defineLLMBehavior({
      name: "summarizer",
      on: ["goal.created"],
      description: "Summarize the goal",
      handler: (_e, _g, _ctx, output) => {
        received = output;
      },
    });

    const exchanges: RecordedExchange[] = [
      {
        request: { model: "rec-model", messages: [{ role: "user", content: "ignored" }] },
        response: {
          text: "the summary",
          inputTokens: 12,
          outputTokens: 3,
          costUsd: 0.0001,
          latencySeconds: 0.05,
        },
      },
    ];
    const provider = new RecordedLLMProvider(exchanges);

    const g = newGraph();
    await new Runtime(g, { llmProvider: provider }).runGoal("summarize");

    const types = g.events.map((e) => e.type);
    expect(types).toContain("llm.requested");
    expect(types).toContain("llm.responded");

    const responded = g.events.find((e) => e.type === "llm.responded");
    expect(responded?.payload.text).toBe("the summary");
    expect(received).toBe("the summary");
  });

  it("populates the cache after a provider call", async () => {
    let calls = 0;
    const provider: LLMProvider = {
      name: "stub",
      defaultModel: "stub-model",
      async complete(_req: LLMRequest): Promise<LLMResponse> {
        calls += 1;
        return { text: "ok", inputTokens: 1, outputTokens: 1, costUsd: 0, latencySeconds: 0 };
      },
      countTokens: () => 1,
    };

    defineLLMBehavior({
      name: "repeat",
      on: ["goal.created", "ping"],
      handler: () => {},
    });

    const g = newGraph();
    const cache = new LLMCache();
    const r = new Runtime(g, { llmProvider: provider, llmCache: cache });

    await r.runGoal("same");
    expect(calls).toBe(1);
    // Verify the cache has at least one entry (the prompt-hash is
    // deterministic per the event payload).
    const cacheMap = (cache as unknown as { map: Map<string, unknown> }).map;
    expect(cacheMap.size).toBe(1);
  });

  it("emits behavior.failed when no llmProvider is configured", async () => {
    defineLLMBehavior({
      name: "needs-llm",
      on: ["goal.created"],
      handler: () => {},
    });

    const g = newGraph();
    await new Runtime(g).runGoal("test");

    const types = g.events.map((e) => e.type);
    expect(types).toContain("behavior.failed");
    const failed = g.events.find((e) => e.type === "behavior.failed");
    expect(String(failed?.payload.message)).toContain("no llmProvider was configured");
  });

  it("strict-replay survives an LLM run via cache", async () => {
    defineLLMBehavior({
      name: "deterministic",
      on: ["goal.created"],
      handler: () => {},
    });

    const exchanges: RecordedExchange[] = [
      {
        request: { model: "rec", messages: [] },
        response: { text: "fixed", inputTokens: 1, outputTokens: 1, costUsd: 0, latencySeconds: 0 },
      },
    ];

    // First run: record the LLM response into the graph events.
    const g1 = newGraph();
    const store = new InMemoryEventStore(g1.runId);
    g1.attachStore(store);
    await new Runtime(g1, { llmProvider: new RecordedLLMProvider(exchanges) }).runGoal("test");

    // Permissive replay always succeeds — no provider call needed.
    await expect(Runtime.load(store)).resolves.toBeDefined();

    // Strict replay also succeeds without a live provider because
    // Runtime.load rebuilds the LLM cache from recorded llm.responded events.
    await expect(Runtime.load(store, { strict: true })).resolves.toBeDefined();

    // LLMCache.fromEvents reads the recorded llm.responded events.
    const cache = LLMCache.fromEvents(g1.events);
    const cacheMap = (cache as unknown as { map: Map<string, unknown> }).map;
    expect(cacheMap.size).toBe(1);
  });
});
