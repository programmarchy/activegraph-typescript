// The context object passed as the third arg to every behavior handler.

import type { Clock, Event, Frame, View } from "@activegraph/core";

export interface RuntimeContext {
  readonly clock: Clock;
  readonly view: View;
  readonly frame: Frame | null;
  /** The event that triggered this behavior invocation. */
  readonly triggeringEvent: Event;
  /** Emit a custom event keyed off the triggering one. */
  emit(type: string, payload?: Record<string, unknown>): void;
}
