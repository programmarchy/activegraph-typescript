// @activegraph/tools — defineTool, ToolContext, RecordedToolProvider.

import { RegistrationError } from "@activegraph/core";

export interface ToolContext {
  /** Identifier of the calling behavior. */
  readonly behaviorName: string;
  /** Event id that initiated the tool call (a `tool.requested`). */
  readonly requestEventId: string;
}

export interface ToolError {
  reason: string;
  details?: Record<string, unknown>;
}

export interface ToolResult<Output = unknown> {
  output?: Output;
  error?: ToolError;
  costUsd?: number;
}

export type ToolHandler<Input = unknown, Output = unknown> = (
  input: Input,
  ctx: ToolContext,
) => Promise<ToolResult<Output>> | ToolResult<Output>;

export interface ToolDef<Input = unknown, Output = unknown> {
  name: string;
  description?: string;
  /** When true, the runtime caches by args_hash so repeat calls are free. */
  deterministic?: boolean;
  handler: ToolHandler<Input, Output>;
}

export interface Tool<Input = unknown, Output = unknown> {
  readonly name: string;
  readonly description: string;
  readonly deterministic: boolean;
  readonly handler: ToolHandler<Input, Output>;
}

const TOOL_REGISTRY: Tool[] = [];

export function defineTool<Input, Output>(def: ToolDef<Input, Output>): Tool<Input, Output> {
  const tool: Tool<Input, Output> = {
    name: def.name,
    description: def.description ?? "",
    deterministic: def.deterministic ?? false,
    handler: def.handler,
  };
  TOOL_REGISTRY.push(tool as Tool);
  return tool;
}

export function getToolRegistry(): readonly Tool[] {
  return TOOL_REGISTRY;
}

export function clearToolRegistry(): Tool[] {
  const cleared = [...TOOL_REGISTRY];
  TOOL_REGISTRY.length = 0;
  return cleared;
}

// --- errors --------------------------------------------------------------

export class MissingToolError extends RegistrationError {
  static override readonly docSlug: string = "missing-tool-error";
}

export class UnknownToolError extends RegistrationError {
  static override readonly docSlug: string = "unknown-tool-error";
}

// --- recorded provider ---------------------------------------------------

export interface RecordedToolExchange {
  tool: string;
  argsHash: string;
  result: ToolResult;
}

export class RecordedToolProvider {
  private cursor = 0;
  constructor(private readonly exchanges: RecordedToolExchange[]) {}

  next(toolName: string): ToolResult {
    const ex = this.exchanges[this.cursor];
    if (ex === undefined || ex.tool !== toolName) {
      throw new MissingToolError(
        `RecordedToolProvider exhausted or mismatched at cursor ${this.cursor} (expected '${toolName}')`,
        {
          whatFailed: `Tool call for '${toolName}' at cursor ${this.cursor} did not match the recorded fixture (${ex ? ex.tool : "no entry"}).`,
          why: "The recorded tool provider replays a fixed transcript so tests stay deterministic. A mismatch means the test's behavior changed without re-recording the fixture.",
          howToFix: "Re-record the fixture or adjust the test so the tool call sequence matches the recording.",
        },
      );
    }
    this.cursor += 1;
    return ex.result;
  }

  reset(): void {
    this.cursor = 0;
  }
}
