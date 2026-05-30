// Prompt assembly contract — what the user-side system + user
// messages contain, hash stability, behavior metadata threading.

import { beforeEach, describe, expect, it } from "vitest";

import { FrozenClock, Graph, IDGen, View } from "@activegraph/core";

import {
  assemblePrompt,
  clearRegistry,
  defineLLMBehavior,
} from "../src/index.js";

function newGraph(): Graph {
  return new Graph({ ids: new IDGen(), clock: new FrozenClock() });
}

function emptyView(): View {
  return new View([], [], []);
}

describe("assemblePrompt", () => {
  beforeEach(() => clearRegistry());

  it("includes behavior name + description in the system message", () => {
    const behavior = defineLLMBehavior({
      name: "summarizer",
      description: "Produce a one-sentence summary.",
      handler: () => {},
    });
    const g = newGraph();
    g.addObject("note", { text: "x" });
    const event = g.events[0]!;
    const p = assemblePrompt({
      behavior,
      event,
      view: emptyView(),
      defaultModel: "test-model",
    });
    expect(p.messages[0]!.role).toBe("system");
    expect(p.messages[0]!.content).toContain("summarizer");
    expect(p.messages[0]!.content).toContain("Produce a one-sentence summary.");
  });

  it("includes 'respond with JSON object' instruction when outputSchema present", () => {
    const behavior = defineLLMBehavior({
      name: "structured",
      outputSchema: { parse: (v: unknown) => v as Record<string, unknown> },
      handler: () => {},
    });
    const g = newGraph();
    g.addObject("note", {});
    const event = g.events[0]!;
    const p = assemblePrompt({
      behavior,
      event,
      view: emptyView(),
      defaultModel: "test",
    });
    expect(p.messages[0]!.content).toContain("JSON object");
  });

  it("lists view objects with type and data in the user message", () => {
    const behavior = defineLLMBehavior({ name: "x", handler: () => {} });
    const g = newGraph();
    const claim = g.addObject("claim", { text: "alpha", confidence: 0.9 });
    const event = g.events[0]!;
    const view = new View([claim], [], []);
    const p = assemblePrompt({ behavior, event, view, defaultModel: "m" });
    expect(p.messages[1]!.content).toContain("claim#1");
    expect(p.messages[1]!.content).toContain("alpha");
  });

  it("uses provider.defaultModel when behavior.model is null", () => {
    const behavior = defineLLMBehavior({ name: "x", handler: () => {} });
    const g = newGraph();
    g.addObject("x", {});
    const event = g.events[0]!;
    const p = assemblePrompt({
      behavior,
      event,
      view: emptyView(),
      defaultModel: "claude-sonnet-4-6",
    });
    expect(p.model).toBe("claude-sonnet-4-6");
  });

  it("uses behavior.model when set, overriding defaultModel", () => {
    const behavior = defineLLMBehavior({
      name: "x",
      model: "specific-model",
      handler: () => {},
    });
    const g = newGraph();
    g.addObject("x", {});
    const event = g.events[0]!;
    const p = assemblePrompt({
      behavior,
      event,
      view: emptyView(),
      defaultModel: "default-model",
    });
    expect(p.model).toBe("specific-model");
  });

  it("hash changes when content changes", () => {
    const behavior = defineLLMBehavior({ name: "x", handler: () => {} });
    const g = newGraph();
    g.addObject("a", {});
    g.addObject("b", {});
    const e1 = g.events[0]!;
    const e2 = g.events[1]!;
    const a = assemblePrompt({
      behavior,
      event: e1,
      view: emptyView(),
      defaultModel: "m",
    });
    const b = assemblePrompt({
      behavior,
      event: e2,
      view: emptyView(),
      defaultModel: "m",
    });
    expect(a.hash).not.toBe(b.hash);
  });
});
