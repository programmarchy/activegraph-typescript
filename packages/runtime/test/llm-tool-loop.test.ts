// LLM tool turn loop — LLM behavior with tools=[] that responds with
// toolCalls triggers the runtime to execute each tool, append a
// tool_result message, and re-prompt; loop until no toolCalls or
// maxToolTurns reached.

import { beforeEach, describe, expect, it } from "vitest";

import { FrozenClock, Graph, IDGen } from "@activegraph/core";
import type { LLMProvider, LLMResponse } from "@activegraph/llm";
import {
  type Tool,
  clearToolRegistry,
  defineTool,
} from "@activegraph/tools";

import {
  Runtime,
  clearRegistry,
  defineLLMBehavior,
} from "../src/index.js";

function newGraph(): Graph {
  return new Graph({ ids: new IDGen(), clock: new FrozenClock() });
}

interface PreparedResponse {
  text: string;
  toolCalls?: Array<{ id: string; name: string; args: Record<string, unknown> }>;
}

function scriptedProvider(script: PreparedResponse[]): LLMProvider {
  let i = 0;
  return {
    name: "scripted",
    defaultModel: "scripted-model",
    async complete(): Promise<LLMResponse> {
      const r = script[i++];
      if (r === undefined) {
        throw new Error(`scripted provider exhausted after ${i - 1} calls`);
      }
      const out: LLMResponse = {
        text: r.text,
        inputTokens: 1,
        outputTokens: 1,
        costUsd: 0,
        latencySeconds: 0,
      };
      if (r.toolCalls !== undefined) out.toolCalls = r.toolCalls;
      return out;
    },
    countTokens: (s) => s.length,
  };
}

describe("LLM tool turn loop", () => {
  beforeEach(() => {
    clearRegistry();
    clearToolRegistry();
  });

  it("executes a single tool call, then a final response (2 turns)", async () => {
    const calls: string[] = [];
    const fetchTool: Tool = defineTool({
      name: "fetch",
      handler: async (args: { url: string }) => {
        calls.push(args.url);
        return { output: `body-of-${args.url}` };
      },
    });

    defineLLMBehavior({
      name: "researcher",
      on: ["goal.created"],
      tools: [fetchTool],
      handler: () => {},
    });

    const provider = scriptedProvider([
      {
        text: "let me fetch",
        toolCalls: [{ id: "call_1", name: "fetch", args: { url: "https://example.com" } }],
      },
      { text: "final answer" },
    ]);

    const g = newGraph();
    await new Runtime(g, { llmProvider: provider }).runGoal("research");

    expect(calls).toEqual(["https://example.com"]);
    const llmReq = g.events.filter((e) => e.type === "llm.requested");
    const toolReq = g.events.filter((e) => e.type === "tool.requested");
    expect(llmReq).toHaveLength(2); // turn 0 + turn 1 (final)
    expect(toolReq).toHaveLength(1);
    // Turn index appears on turn 1+.
    expect(llmReq[0]!.payload.turn_index).toBeUndefined();
    expect(llmReq[1]!.payload.turn_index).toBe(1);
  });

  it("loops across multiple tool calls in one turn", async () => {
    const calls: string[] = [];
    const fetchTool = defineTool({
      name: "fetch",
      handler: async (args: { url: string }) => {
        calls.push(args.url);
        return { output: args.url };
      },
    });

    defineLLMBehavior({
      name: "multi",
      on: ["goal.created"],
      tools: [fetchTool],
      handler: () => {},
    });

    const provider = scriptedProvider([
      {
        text: "fetch both",
        toolCalls: [
          { id: "c1", name: "fetch", args: { url: "a" } },
          { id: "c2", name: "fetch", args: { url: "b" } },
        ],
      },
      { text: "done" },
    ]);

    const g = newGraph();
    await new Runtime(g, { llmProvider: provider }).runGoal("multi");
    expect(calls).toEqual(["a", "b"]);
    expect(g.events.filter((e) => e.type === "tool.responded")).toHaveLength(2);
  });

  it("caps at maxToolTurns and throws", async () => {
    const loopingTool = defineTool({
      name: "loop",
      handler: async () => ({ output: "x" }),
    });

    defineLLMBehavior({
      name: "looper",
      on: ["goal.created"],
      tools: [loopingTool],
      maxToolTurns: 3,
      handler: () => {},
    });

    // Always returns a toolCall — should hit the cap.
    const provider = scriptedProvider([
      { text: "1", toolCalls: [{ id: "c1", name: "loop", args: {} }] },
      { text: "2", toolCalls: [{ id: "c2", name: "loop", args: {} }] },
      { text: "3", toolCalls: [{ id: "c3", name: "loop", args: {} }] },
    ]);

    const g = newGraph();
    await new Runtime(g, { llmProvider: provider }).runGoal("loop");

    const failed = g.events.find((e) => e.type === "behavior.failed")!;
    expect(failed).toBeDefined();
    expect(String(failed.payload.message)).toContain("maxToolTurns");
  });

  it("rejects an undeclared tool call (behavior.failed)", async () => {
    const fetchTool = defineTool({
      name: "fetch",
      handler: async () => ({ output: "x" }),
    });
    // The behavior declares `fetch` but the model calls `write` — runtime
    // refuses.
    defineLLMBehavior({
      name: "scoped",
      on: ["goal.created"],
      tools: [fetchTool],
      handler: () => {},
    });

    const provider = scriptedProvider([
      { text: "bad", toolCalls: [{ id: "c1", name: "write", args: {} }] },
      { text: "wont-reach" },
    ]);

    const g = newGraph();
    await new Runtime(g, { llmProvider: provider }).runGoal("test");

    const failed = g.events.find((e) => e.type === "behavior.failed")!;
    expect(failed).toBeDefined();
    expect(String(failed.payload.message)).toContain("not declared");
  });
});
