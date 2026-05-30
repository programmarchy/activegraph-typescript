// Anthropic LLM provider. Uses @anthropic-ai/sdk.

import Anthropic from "@anthropic-ai/sdk";

import { MissingOptionalDependency } from "@activegraph/core";
import type { LLMProvider, LLMRequest, LLMResponse } from "@activegraph/llm";

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
    const messages = request.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

    const t0 = performance.now();
    const response = await this.client.messages.create({
      model: request.model || this.defaultModel,
      max_tokens: request.maxTokens ?? 4096,
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.topP !== undefined ? { top_p: request.topP } : {}),
      ...(systems.length > 0 ? { system: systems.join("\n\n") } : {}),
      messages,
    });
    const latencySeconds = (performance.now() - t0) / 1000;

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    return {
      text,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      // Cost calc would lookup the model price; left null in v1.0.5.
      costUsd: null,
      latencySeconds,
      raw: response as unknown as Record<string, unknown>,
    };
  }

  countTokens(text: string, _model?: string): number {
    // Anthropic's exact tokenizer is closed; the SDK exposes a count API
    // but it does a network round-trip. For local estimation we use a
    // ~4-chars-per-token heuristic, matching the Python fallback. The
    // estimate is loud (`tokens_in~N` in the trace) so callers know.
    return Math.ceil(text.length / 4);
  }
}
