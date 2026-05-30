// The context object passed as the third arg to every behavior handler.

import type { Clock, Event, Frame, View } from "@activegraph/core";
import type { ToolResult } from "@activegraph/tools";

import type { MatchHandle } from "./patterns.js";

export interface RuntimeContext {
  readonly clock: Clock;
  readonly view: View;
  readonly frame: Frame | null;
  /** The event that triggered this behavior invocation. */
  readonly triggeringEvent: Event;
  /**
   * Pattern bindings, when the behavior subscribed via `pattern:`. Empty
   * array for event-only / where-only behaviors.
   */
  readonly matches: readonly MatchHandle[];
  /** Emit a custom event keyed off the triggering one. */
  emit(type: string, payload?: Record<string, unknown>): void;
  /**
   * Invoke a registered tool. Wraps the call with tool.requested /
   * tool.responded events; cached for deterministic tools.
   */
  callTool<Input, Output>(name: string, args: Input): Promise<ToolResult<Output>>;
}
