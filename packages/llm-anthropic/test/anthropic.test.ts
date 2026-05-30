// AnthropicProvider — stubs the SDK client so no live API call happens.
// Verifies: constructor wiring, system-message split, complete()
// translation of messages → SDK format and response → LLMResponse,
// MissingOptionalDependency without key+client.

import { describe, expect, it, vi } from "vitest";

import { MissingOptionalDependency } from "@activegraph/core";

import { AnthropicProvider } from "../src/index.js";

interface FakeClient {
  messages: {
    create: ReturnType<typeof vi.fn>;
  };
}

function fakeClient(create: (req: unknown) => unknown): FakeClient {
  return {
    messages: { create: vi.fn(async (req) => create(req)) },
  };
}

describe("AnthropicProvider", () => {
  it("throws MissingOptionalDependency when no apiKey and no client", () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = undefined;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      expect(() => new AnthropicProvider()).toThrow(MissingOptionalDependency);
    } finally {
      if (prev !== undefined) process.env.ANTHROPIC_API_KEY = prev;
    }
  });

  it("accepts an apiKey and uses claude-sonnet-4-6 as default model", () => {
    const p = new AnthropicProvider({ apiKey: "sk-fake" });
    expect(p.name).toBe("anthropic");
    expect(p.defaultModel).toBe("claude-sonnet-4-6");
  });

  it("complete() splits system messages into the top-level `system` arg", async () => {
    let observed: unknown = null;
    const client = fakeClient((req) => {
      observed = req;
      return {
        content: [{ type: "text", text: "answer" }],
        usage: { input_tokens: 12, output_tokens: 3 },
      };
    });
    const p = new AnthropicProvider({
      apiKey: "sk-fake",
      client: client as unknown as ConstructorParameters<typeof AnthropicProvider>[0]["client"],
    });

    const r = await p.complete({
      model: "claude-test",
      messages: [
        { role: "system", content: "you are X" },
        { role: "user", content: "hello" },
      ],
    });
    expect(r.text).toBe("answer");
    expect(r.inputTokens).toBe(12);
    expect(r.outputTokens).toBe(3);

    const req = observed as { system?: string; messages: Array<{ role: string; content: string }> };
    expect(req.system).toBe("you are X");
    expect(req.messages).toEqual([{ role: "user", content: "hello" }]);
  });

  it("countTokens uses the heuristic when no SDK tokenizer is wired", () => {
    const p = new AnthropicProvider({ apiKey: "sk-fake" });
    expect(p.countTokens("hello world")).toBeGreaterThan(0);
  });
});
