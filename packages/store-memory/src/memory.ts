// In-memory EventStore. Volatile, dict-backed. Useful for tests and as
// the reference implementation of the EventStore protocol.

import type { Event } from "@activegraph/core";

import type { EventStore, IterEventsOptions } from "./base.js";
import { DuplicateEventError, EventNotFoundError } from "./errors.js";

function eventNotFound(
  eventId: string,
  runId: string,
  where: string,
): EventNotFoundError {
  return new EventNotFoundError(`event '${eventId}' not found in run '${runId}'`, {
    whatFailed: `The in-memory store was asked for event '${eventId}' (in ${where}) but no event with that id exists in run '${runId}'.`,
    why: "Event ids are the addressing primitive for the entire framework — the replay cache, the causal-chain walk, and the fork primitive all reference events by id. A lookup against an unknown id is a bug in the caller; returning a default would silently corrupt the audit trail.",
    howToFix: `Check the event id against the events that actually exist in this run.\nCommon causes:\n  - typo in a hand-typed event id (evt_42 vs evt_042)\n  - referencing an id from a different run\n  - the run was truncated by an earlier fork or replay`,
    context: { event_id: eventId, run_id: runId, where },
  });
}

export class InMemoryEventStore implements EventStore {
  readonly runId: string;
  private events: Event[] = [];
  private byId = new Map<string, number>();

  constructor(runId = "run_mem") {
    this.runId = runId;
  }

  append(event: Event): void {
    if (this.byId.has(event.id)) {
      throw new DuplicateEventError(`duplicate event id: ${event.id}`, {
        whatFailed: `An event with id '${event.id}' already exists in this in-memory store. Appends are id-unique.`,
        why: "Event ids are the addressing primitive for the entire framework — behaviors reference events by id, the replay cache keys on them, the causal chain walks them. A duplicate id would silently reroute one of those references, corrupting the audit trail.",
        howToFix:
          "Event ids in normal use come from the runtime's monotonic id generator (IDGen) and cannot collide. A duplicate almost always means a test fixture is hand-constructing events with fixed ids and a previous test left state behind. Use IDGen to generate ids, or construct a fresh Graph between tests.",
        context: { event_id: event.id, run_id: this.runId },
      });
    }
    this.byId.set(event.id, this.events.length);
    this.events.push(event);
  }

  *iterEvents(opts: IterEventsOptions = {}): Iterable<Event> {
    let start = 0;
    let end = this.events.length;
    if (opts.after !== undefined) {
      const idx = this.byId.get(opts.after);
      if (idx === undefined) {
        throw eventNotFound(opts.after, this.runId, "iterEvents({ after })");
      }
      start = idx + 1;
    }
    if (opts.until !== undefined) {
      const idx = this.byId.get(opts.until);
      if (idx === undefined) {
        throw eventNotFound(opts.until, this.runId, "iterEvents({ until })");
      }
      end = idx + 1;
    }
    for (let i = start; i < end; i++) {
      yield this.events[i]!;
    }
  }

  getEvent(eventId: string): Event | null {
    const idx = this.byId.get(eventId);
    if (idx === undefined) return null;
    return this.events[idx]!;
  }

  count(): number {
    return this.events.length;
  }

  truncateAfter(eventId: string): void {
    const idx = this.byId.get(eventId);
    if (idx === undefined) {
      throw eventNotFound(eventId, this.runId, "truncateAfter(eventId)");
    }
    const cut = idx + 1;
    const dropped = this.events.slice(cut);
    this.events = this.events.slice(0, cut);
    for (const ev of dropped) this.byId.delete(ev.id);
  }

  close(): void {
    // no-op
  }
}
