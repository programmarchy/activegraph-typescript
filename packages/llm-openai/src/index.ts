// OpenAI LLM provider. Uses the official `openai` SDK + gpt-tokenizer
// for accurate input-token counts.

import { encode } from "gpt-tokenizer";
import OpenAI from "openai";
import type {
  ChatCompletionMessageFunctionToolCall,
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionToolMessageParam,
} from "openai/resources/chat/completions";

import { MissingOptionalDependency } from "@activegraph/core";
import type { LLMMessage, LLMProvider, LLMRequest, LLMResponse } from "@activegraph/llm";

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
      messages: request.messages.map(toOpenAIMessage),
      max_tokens: request.maxTokens ?? 4096,
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.topP !== undefined ? { top_p: request.topP } : {}),
      ...(request.tools !== undefined && request.tools.length > 0
        ? {
            tools: request.tools.map((tool) => ({
              type: "function" as const,
              function: {
                name: tool.name,
                description: tool.description ?? "",
                parameters: { type: "object", properties: {}, additionalProperties: true },
              },
            })),
          }
        : {}),
    });
    const latencySeconds = (performance.now() - t0) / 1000;

    const text = response.choices[0]?.message?.content ?? "";
    const usage = response.usage;
    const toolCalls = extractToolCalls(response.choices[0]?.message?.tool_calls);

    const result: LLMResponse = {
      text,
      inputTokens: usage?.prompt_tokens ?? 0,
      outputTokens: usage?.completion_tokens ?? 0,
      costUsd: null,
      latencySeconds,
      raw: response as unknown as Record<string, unknown>,
    };
    if (toolCalls !== undefined) result.toolCalls = toolCalls;
    return result;
  }

  countTokens(text: string, _model?: string): number {
    return encode(text).length;
  }
}

function extractToolCalls(
  calls: ChatCompletionMessageToolCall[] | undefined,
): NonNullable<LLMResponse["toolCalls"]> | undefined {
  if (calls === undefined) return undefined;
  const functionCalls = calls.filter(isFunctionToolCall);
  if (functionCalls.length === 0) return undefined;
  return functionCalls.map((call) => ({
    id: call.id,
    name: call.function.name,
    args: parseToolArgs(call.function.arguments),
  }));
}

function isFunctionToolCall(
  call: ChatCompletionMessageToolCall,
): call is ChatCompletionMessageFunctionToolCall {
  return call.type === "function";
}

function parseToolArgs(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : { value: parsed };
  } catch {
    return { _raw: raw };
  }
}

function toOpenAIMessage(m: LLMMessage): ChatCompletionMessageParam {
  if (m.role === "tool") {
    const result: ChatCompletionToolMessageParam = {
      role: "tool",
      tool_call_id: m.toolResult?.toolCallId ?? "",
      content: m.content,
    };
    return result;
  }
  if (m.role === "assistant") {
    return {
      role: "assistant",
      content: m.content,
      ...(m.toolCalls && m.toolCalls.length > 0
        ? {
            tool_calls: m.toolCalls.map((c) => ({
              id: c.id,
              type: "function" as const,
              function: { name: c.name, arguments: JSON.stringify(c.args) },
            })),
          }
        : {}),
    };
  }
  return { role: m.role, content: m.content };
}
