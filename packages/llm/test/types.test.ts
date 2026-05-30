// Type-shape sanity for the LLM public surface.

import { describe, expect, it } from "vitest";

import {
  type LLMMessage,
  type LLMProvider,
  type LLMResponse,
  type LLMToolCall,
  type LLMToolResult,
  LLMBehaviorError,
  MissingProviderError,
  RecordedLLMProvider,
} from "../src/index.js";

describe("LLM type surface", () => {
  it("LLMMessage tolerates the four role kinds", () => {
    const msgs: LLMMessage[] = [
      { role: "system", content: "s" },
      { role: "user", content: "u" },
      { role: "assistant", content: "a", toolCalls: [] },
      { role: "tool", content: "t", toolResult: { toolCallId: "x" } },
    ];
    expect(msgs).toHaveLength(4);
  });

  it("LLMToolCall + LLMToolResult are pure data", () => {
    const call: LLMToolCall = { id: "c1", name: "fetch", args: { url: "x" } };
    const result: LLMToolResult = { toolCallId: "c1", output: "ok" };
    expect(call.id).toBe("c1");
    expect(result.toolCallId).toBe("c1");
  });

  it("RecordedLLMProvider satisfies LLMProvider", () => {
    const p: LLMProvider = new RecordedLLMProvider([]);
    expect(p.name).toBe("recorded");
    expect(typeof p.complete).toBe("function");
    expect(typeof p.countTokens).toBe("function");
  });

  it("LLMBehaviorError and MissingProviderError are RegistrationError leaves", async () => {
    const { RegistrationError } = await import("@activegraph/core");
    expect(new LLMBehaviorError("x")).toBeInstanceOf(RegistrationError);
    expect(new MissingProviderError("x")).toBeInstanceOf(RegistrationError);
  });

  it("LLMResponse shape supports tool_calls or final text", () => {
    const finalResp: LLMResponse = {
      text: "done",
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      latencySeconds: 0,
    };
    const toolResp: LLMResponse = {
      text: "thinking",
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      latencySeconds: 0,
      toolCalls: [{ id: "c1", name: "x", args: {} }],
    };
    expect(finalResp.toolCalls).toBeUndefined();
    expect(toolResp.toolCalls).toHaveLength(1);
  });
});
