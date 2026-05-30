// EventStore interface + run metadata.
//
// An EventStore is a per-run, append-only view onto an event log. Methods
// are deliberately minimal — append, iterate, count, lookup, truncate.
// All I/O methods are async so SQLite / Postgres implementations can be
// honest about their I/O without forcing the in-memory store to spin up
// promises unnecessarily (it just resolves synchronously).

import type { Event, Graph } from "@activegraph/core";

export interface RunRecord {
  runId: string;
  parentRunId: string | null;
  forkedAtEventId: string | null;
  label: string | null;
  createdAt: string;
  goal: string | null;
  frameId: string | null;
}

export interface IterEventsOptions {
  /** Yield events after (but not including) this id. */
  after?: string;
  /** Yield events up to and including this id. */
  until?: string;
}

export interface EventStore {
  readonly runId: string;

  append(event: Event): Promise<void> | void;

  iterEvents(opts?: IterEventsOptions): AsyncIterable<Event> | Iterable<Event>;

  getEvent(eventId: string): Promise<Event | null> | Event | null;

  count(): Promise<number> | number;

  truncateAfter(eventId: string): Promise<void> | void;

  close(): Promise<void> | void;
}

/**
 * Apply a stream of events to a Graph without firing listeners.
 *
 * The single replay entry point — used by Runtime.load and Runtime.fork.
 * Returns the number of events replayed.
 */
export async function replayInto(
  graph: Graph,
  events: AsyncIterable<Event> | Iterable<Event>,
): Promise<number> {
  let n = 0;
  for await (const ev of events as AsyncIterable<Event>) {
    graph.replayEvent(ev);
    n += 1;
  }
  return n;
}
