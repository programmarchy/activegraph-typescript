// Anthropic LLM provider. Uses @anthropic-ai/sdk.

import Anthropic from "@anthropic-ai/sdk";

import { MissingOptionalDependency } from "@activegraph/core";
import type { LLMMessage, LLMProvider, LLMRequest, LLMResponse } from "@activegraph/llm";

export interface AnthropicProviderOptions {
  /** Anthropic API key. Falls back to ANTHROPIC_API_KEY env var. */
  apiKey?: string;
  defaultModel?: string;
  baseURL?: string;
  /** Pre-built client (test injection or shared SDK instance). */
  client?: Anthropic;
}

export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  readonly defaultModel: string;
  readonly apiKey: string;
  readonly baseURL: string | null;
  private readonly client: Anthropic;

  constructor(opts: AnthropicProviderOptions = {}) {
    const key = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!key && !opts.client) {
      throw new MissingOptionalDependency({
        pkg: "@anthropic-ai/sdk",
        feature: "AnthropicProvider",
        extras: "llm-anthropic",
      });
    }
    this.apiKey = key ?? "";
    this.defaultModel = opts.defaultModel ?? "claude-sonnet-4-6";
    this.baseURL = opts.baseURL ?? null;
    this.client =
      opts.client ??
      new Anthropic({
        apiKey: this.apiKey,
        ...(this.baseURL !== null ? { baseURL: this.baseURL } : {}),
      });
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    // The Anthropic API splits system from user/assistant. We pull the first
    // system message out if present and pass it as the top-level `system` arg.
    const systems = request.messages.filter((m) => m.role === "system").map((m) => m.content);
    const messages = request.messages.filter((m) => m.role !== "system").map(toAnthropicMessage);

    const t0 = performance.now();
    const response = await this.client.messages.create({
      model: request.model || this.defaultModel,
      max_tokens: request.maxTokens ?? 4096,
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.topP !== undefined ? { top_p: request.topP } : {}),
      ...(systems.length > 0 ? { system: systems.join("\n\n") } : {}),
      ...(request.tools !== undefined && request.tools.length > 0
        ? {
            tools: request.tools.map((tool) => ({
              name: tool.name,
              description: tool.description ?? "",
              input_schema: { type: "object", properties: {} },
            })),
          }
        : {}),
      messages,
    });
    const latencySeconds = (performance.now() - t0) / 1000;

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    const toolCalls = extractToolCalls(response.content);

    const result: LLMResponse = {
      text,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      // Cost calc would lookup the model price; left null in v1.0.5.
      costUsd: null,
      latencySeconds,
      raw: response as unknown as Record<string, unknown>,
    };
    if (toolCalls !== undefined) result.toolCalls = toolCalls;
    return result;
  }

  countTokens(text: string, _model?: string): number {
    // Anthropic's exact tokenizer is closed; the SDK exposes a count API
    // but it does a network round-trip. For local estimation we use a
    // ~4-chars-per-token heuristic, matching the Python fallback. The
    // estimate is loud (`tokens_in~N` in the trace) so callers know.
    return Math.ceil(text.length / 4);
  }
}

function toAnthropicMessage(m: LLMMessage): Anthropic.Messages.MessageParam {
  if (m.role === "tool") {
    return {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: m.toolResult?.toolCallId ?? "",
          content: m.content,
        },
      ],
    };
  }
  if (m.role === "assistant" && m.toolCalls !== undefined && m.toolCalls.length > 0) {
    const content: Anthropic.Messages.ContentBlockParam[] = [];
    if (m.content !== "") content.push({ type: "text", text: m.content });
    for (const call of m.toolCalls) {
      content.push({
        type: "tool_use",
        id: call.id,
        name: call.name,
        input: call.args,
      });
    }
    return { role: "assistant", content };
  }
  return { role: m.role === "assistant" ? "assistant" : "user", content: m.content };
}

function extractToolCalls(
  content: Anthropic.Message["content"],
): NonNullable<LLMResponse["toolCalls"]> | undefined {
  const calls = content
    .filter((block): block is Anthropic.ToolUseBlock => block.type === "tool_use")
    .map((block) => ({
      id: block.id,
      name: block.name,
      args:
        block.input !== null && typeof block.input === "object" && !Array.isArray(block.input)
          ? (block.input as Record<string, unknown>)
          : { value: block.input },
    }));
  return calls.length > 0 ? calls : undefined;
}
