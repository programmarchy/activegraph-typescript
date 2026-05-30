// @activegraph/llm — provider interface + recorded provider.
//
// Concrete provider implementations live in sibling packages
// (@activegraph/llm-anthropic, @activegraph/llm-openai). Every shipped
// provider implements the same LLMProvider interface so swapping one for
// another doesn't require touching defineLLMBehavior() definitions.

import { RegistrationError } from "@activegraph/core";

export interface LLMToolCall {
  /** Provider-issued id; needed by Anthropic to pair with tool_result. */
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface LLMToolResult {
  toolCallId: string;
  output?: unknown;
  error?: string;
}

export interface LLMMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  /** Present on assistant messages when the model emitted tool_use blocks. */
  toolCalls?: LLMToolCall[];
  /** Present on tool-result messages — the answer to a previous toolCall. */
  toolResult?: LLMToolResult;
}

export interface LLMRequest {
  model: string;
  messages: LLMMessage[];
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  deterministic?: boolean;
  timeoutSeconds?: number;
  tools?: Array<{ name: string; description?: string }>;
}

export interface LLMResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
  latencySeconds: number;
  /**
   * Tool calls the model wants the runtime to execute before continuing.
   * When undefined or empty, this is the final response.
   */
  toolCalls?: LLMToolCall[];
  /** Raw provider payload — debugging only. */
  raw?: Record<string, unknown>;
}

export interface LLMProvider {
  readonly name: string;
  readonly defaultModel: string;
  complete(request: LLMRequest): Promise<LLMResponse>;
  countTokens(text: string, model?: string): number;
}

// --- errors ---------------------------------------------------------------

export class LLMBehaviorError extends RegistrationError {
  static override readonly docSlug: string = "llm-behavior-error";
}

export class MissingProviderError extends RegistrationError {
  static override readonly docSlug: string = "missing-provider-error";
}

// --- recorded provider (deterministic replay) ----------------------------

export interface RecordedExchange {
  request: { model: string; messages: LLMMessage[] };
  response: LLMResponse;
}

export class RecordedLLMProvider implements LLMProvider {
  readonly name = "recorded";
  readonly defaultModel: string;
  private cursor = 0;

  constructor(
    private readonly exchanges: RecordedExchange[],
    opts: { defaultModel?: string } = {},
  ) {
    this.defaultModel = opts.defaultModel ?? "recorded";
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const recorded = this.exchanges[this.cursor];
    if (recorded === undefined) {
      throw new LLMBehaviorError(
        `RecordedLLMProvider exhausted: no more exchanges after index ${this.cursor - 1}`,
        {
          whatFailed: `A behavior asked the recorded LLM provider for completion ${this.cursor + 1}, but only ${this.exchanges.length} exchanges were recorded.`,
          why: "The recorded provider replays a fixed transcript of LLM calls so tests are deterministic. Once the transcript is exhausted, further requests cannot be served without falling back to a live API call — which would break determinism.",
          howToFix: `Re-record the fixture with the extra calls included, or shorten the test so it makes at most ${this.exchanges.length} LLM calls.`,
          context: {
            requested_model: request.model,
            recorded_count: this.exchanges.length,
            cursor: this.cursor,
          },
        },
      );
    }
    this.cursor += 1;
    return recorded.response;
  }

  countTokens(text: string, _model?: string): number {
    // Heuristic — real providers use proper tokenizers.
    return Math.ceil(text.length / 4);
  }

  reset(): void {
    this.cursor = 0;
  }
}
