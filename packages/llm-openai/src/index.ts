// OpenAI LLM provider. Uses the official `openai` SDK + gpt-tokenizer
// for accurate input-token counts.

import { encode } from "gpt-tokenizer";
import OpenAI from "openai";

import { MissingOptionalDependency } from "@activegraph/core";
import type { LLMProvider, LLMRequest, LLMResponse } from "@activegraph/llm";

export interface OpenAIProviderOptions {
  /** OpenAI API key. Falls back to OPENAI_API_KEY env var. */
  apiKey?: string;
  defaultModel?: string;
  baseURL?: string;
  /** Pre-built client (test injection or shared SDK instance). */
  client?: OpenAI;
}

export class OpenAIProvider implements LLMProvider {
  readonly name = "openai";
  readonly defaultModel: string;
  readonly apiKey: string;
  readonly baseURL: string | null;
  private readonly client: OpenAI;

  constructor(opts: OpenAIProviderOptions = {}) {
    const key = opts.apiKey ?? process.env.OPENAI_API_KEY;
    if (!key && !opts.client) {
      throw new MissingOptionalDependency({
        pkg: "openai",
        feature: "OpenAIProvider",
        extras: "llm-openai",
      });
    }
    this.apiKey = key ?? "";
    this.defaultModel = opts.defaultModel ?? "gpt-4o-mini";
    this.baseURL = opts.baseURL ?? null;
    this.client =
      opts.client ??
      new OpenAI({
        apiKey: this.apiKey,
        ...(this.baseURL !== null ? { baseURL: this.baseURL } : {}),
      });
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const t0 = performance.now();
    const response = await this.client.chat.completions.create({
      model: request.model || this.defaultModel,
      messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
      max_tokens: request.maxTokens ?? 4096,
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.topP !== undefined ? { top_p: request.topP } : {}),
    });
    const latencySeconds = (performance.now() - t0) / 1000;

    const text = response.choices[0]?.message?.content ?? "";
    const usage = response.usage;

    return {
      text,
      inputTokens: usage?.prompt_tokens ?? 0,
      outputTokens: usage?.completion_tokens ?? 0,
      costUsd: null,
      latencySeconds,
      raw: response as unknown as Record<string, unknown>,
    };
  }

  countTokens(text: string, _model?: string): number {
    // gpt-tokenizer is pure-JS, no wasm download, accurate for GPT-4/4o
    // family.
    return encode(text).length;
  }
}
