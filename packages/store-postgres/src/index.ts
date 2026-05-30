// Postgres-backed EventStore. Skeleton — real implementation in Phase 3
// uses `pg`. Public surface matches InMemoryEventStore.

import type { Event } from "@activegraph/core";
import type { EventStore, IterEventsOptions } from "@activegraph/store-memory";
import { InMemoryEventStore } from "@activegraph/store-memory";

export interface PostgresEventStoreOptions {
  /** Postgres connection string, e.g. `postgres://user:pass@host/db`. */
  url: string;
  runId?: string;
}

export class PostgresEventStore implements EventStore {
  readonly runId: string;
  private readonly inner: InMemoryEventStore;
  readonly url: string;

  constructor(opts: PostgresEventStoreOptions) {
    this.url = opts.url;
    this.runId = opts.runId ?? "run_pg";
    this.inner = new InMemoryEventStore(this.runId);
  }

  async append(event: Event): Promise<void> {
    this.inner.append(event);
  }

  iterEvents(opts: IterEventsOptions = {}): Iterable<Event> {
    return this.inner.iterEvents(opts);
  }

  async getEvent(eventId: string): Promise<Event | null> {
    return this.inner.getEvent(eventId);
  }

  async count(): Promise<number> {
    return this.inner.count();
  }

  async truncateAfter(eventId: string): Promise<void> {
    this.inner.truncateAfter(eventId);
  }

  async close(): Promise<void> {
    this.inner.close();
  }
}
