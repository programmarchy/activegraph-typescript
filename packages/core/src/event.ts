// Event records. Append-only, never modified.

export interface EventPayload {
  [key: string]: unknown;
}

/**
 * An entry in the event log.
 *
 * Treated as immutable by convention; the runtime never modifies an event
 * after it has been emitted. The `payload` object is not deeply frozen but
 * must not be mutated by callers.
 */
export interface Event {
  readonly id: string;
  readonly type: string;
  readonly payload: EventPayload;
  readonly actor: string | null;
  readonly frameId: string | null;
  readonly causedBy: string | null;
  readonly timestamp: string;
}

export interface EventInit {
  id: string;
  type: string;
  payload?: EventPayload;
  actor?: string | null;
  frameId?: string | null;
  causedBy?: string | null;
  timestamp?: string;
}

export function makeEvent(init: EventInit): Event {
  return {
    id: init.id,
    type: init.type,
    payload: init.payload ?? {},
    actor: init.actor ?? null,
    frameId: init.frameId ?? null,
    causedBy: init.causedBy ?? null,
    timestamp: init.timestamp ?? "",
  };
}

export function eventToJSON(e: Event): Record<string, unknown> {
  return {
    id: e.id,
    type: e.type,
    payload: e.payload,
    actor: e.actor,
    frame_id: e.frameId,
    caused_by: e.causedBy,
    timestamp: e.timestamp,
  };
}
