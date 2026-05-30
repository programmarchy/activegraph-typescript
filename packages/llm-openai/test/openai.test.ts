// OpenAIProvider — stubs the SDK client. Verifies wiring, message
// translation (tool / assistant tool_calls), countTokens via
// gpt-tokenizer, MissingOptionalDependency.

import { describe, expect, it, vi } from "vitest";

import { MissingOptionalDependency } from "@activegraph/core";

import { OpenAIProvider } from "../src/index.js";

interface FakeClient {
  chat: {
    completions: {
      create: ReturnType<typeof vi.fn>;
    };
  };
}

function fakeClient(create: (req: unknown) => unknown): FakeClient {
  return {
    chat: { completions: { create: vi.fn(async (req) => create(req)) } },
  };
}

describe("OpenAIProvider", () => {
  it("throws MissingOptionalDependency when no apiKey + no client", () => {
    const prev = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      expect(() => new OpenAIProvider()).toThrow(MissingOptionalDependency);
    } finally {
      if (prev !== undefined) process.env.OPENAI_API_KEY = prev;
    }
  });

  it("defaults model to gpt-4o-mini", () => {
    const p = new OpenAIProvider({ apiKey: "sk-fake" });
    expect(p.defaultModel).toBe("gpt-4o-mini");
  });

  it("complete() maps assistant tool_calls + tool role correctly", async () => {
    let observed: unknown = null;
    const client = fakeClient((req) => {
      observed = req;
      return {
        choices: [{ message: { content: "final" } }],
        usage: { prompt_tokens: 50, completion_tokens: 5 },
      };
    });
    const p = new OpenAIProvider({
      apiKey: "sk-fake",
      client: client as unknown as ConstructorParameters<typeof OpenAIProvider>[0]["client"],
    });
    const r = await p.complete({
      model: "gpt-test",
      messages: [
        { role: "user", content: "hi" },
        {
          role: "assistant",
          content: "thinking",
          toolCalls: [{ id: "c1", name: "fetch", args: { url: "x" } }],
        },
        { role: "tool", content: '"data"', toolResult: { toolCallId: "c1" } },
      ],
    });
    expect(r.text).toBe("final");
    expect(r.inputTokens).toBe(50);
    expect(r.outputTokens).toBe(5);

    interface MessageReq {
      role: string;
      tool_call_id?: string;
      tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
    }
    const req = observed as { messages: MessageReq[] };
    expect(req.messages[1]!.tool_calls).toBeDefined();
    expect(req.messages[1]!.tool_calls![0]!.function.name).toBe("fetch");
    expect(req.messages[1]!.tool_calls![0]!.function.arguments).toBe('{"url":"x"}');
    expect(req.messages[2]!.role).toBe("tool");
    expect(req.messages[2]!.tool_call_id).toBe("c1");
  });

  it("countTokens uses gpt-tokenizer (accurate, not heuristic)", () => {
    const p = new OpenAIProvider({ apiKey: "sk-fake" });
    expect(p.countTokens("Hello, world!")).toBeGreaterThan(0);
    expect(p.countTokens("Hello, world!")).toBeLessThan(10);
  });
});
