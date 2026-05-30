// Parse a store URL into an EventStore.
//
// Supported forms:
//   sqlite:///path/to/db          → SQLiteEventStore { path: "/path/to/db" }
//   sqlite::memory:               → SQLiteEventStore { path: ":memory:" }
//   memory:                        → InMemoryEventStore
//   postgres://user@host/db?...    → not yet implemented at the CLI layer

import type { EventStore } from "@activegraph/store-memory";
import { InMemoryEventStore } from "@activegraph/store-memory";
import { SQLiteEventStore } from "@activegraph/store-sqlite";

export interface OpenStoreOptions {
  runId?: string;
}

export function openStore(url: string, opts: OpenStoreOptions = {}): EventStore {
  if (url === "memory:" || url === "memory:///") {
    return new InMemoryEventStore(opts.runId ?? "run_mem");
  }
  if (url.startsWith("sqlite:")) {
    const path =
      url === "sqlite::memory:"
        ? ":memory:"
        : url.replace(/^sqlite:\/\/\/?/, "/").replace(/^\/+/, "/");
    return new SQLiteEventStore({
      path,
      ...(opts.runId !== undefined ? { runId: opts.runId } : {}),
    });
  }
  if (url.startsWith("postgres:") || url.startsWith("postgresql:")) {
    throw new Error(
      "postgres:// URLs from the CLI not yet supported in this build — instantiate PostgresEventStore directly",
    );
  }
  throw new Error(
    `unknown store URL scheme: '${url}'. Supported: sqlite:///path, sqlite::memory:, memory:`,
  );
}
