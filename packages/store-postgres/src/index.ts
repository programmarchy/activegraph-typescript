// Postgres-backed EventStore (pg).
//
// Schema parallels SQLite: events(seq BIGSERIAL PK, id TEXT, type TEXT, ...
// run_id TEXT, UNIQUE(id, run_id)); runs(...); meta(key PK, value).
// A Postgres store is scoped to ONE run_id; other runs in the same DB
// are accessed via separate instances over the same connection URL.

import pg from "pg";

import type { Event } from "@activegraph/core";
import { makeEvent } from "@activegraph/core";
import {
  DuplicateEventError,
  EventNotFoundError,
  type EventStore,
  type IterEventsOptions,
  SchemaVersionMismatch,
} from "@activegraph/store-memory";

const { Pool } = pg;
type Pool = pg.Pool;

const SCHEMA_VERSION = "1";

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS events (
    seq BIGSERIAL PRIMARY KEY,
    id TEXT NOT NULL,
    type TEXT NOT NULL,
    actor TEXT,
    payload JSONB NOT NULL,
    frame_id TEXT,
    caused_by TEXT,
    timestamp TEXT NOT NULL,
    run_id TEXT NOT NULL,
    UNIQUE(id, run_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_events_run ON events(run_id, seq)`,
  `CREATE INDEX IF NOT EXISTS idx_events_type ON events(type)`,
  `CREATE TABLE IF NOT EXISTS runs (
    run_id TEXT PRIMARY KEY,
    parent_run_id TEXT,
    forked_at_event_id TEXT,
    label TEXT,
    created_at TEXT NOT NULL,
    goal TEXT,
    frame_id TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
];

export interface PostgresEventStoreOptions {
  /** Postgres connection string. */
  url: string;
  runId?: string;
}

interface EventRow {
  id: string;
  type: string;
  actor: string | null;
  payload: unknown;
  frame_id: string | null;
  caused_by: string | null;
  timestamp: string;
  seq: string;
}

/**
 * Postgres-backed EventStore. Async throughout — every method returns a
 * Promise. Use `await store.append(ev)`, `for await (const ev of
 * store.iterEvents())`, etc.
 */
export class PostgresEventStore implements EventStore {
  readonly runId: string;
  readonly url: string;
  private readonly pool: Pool;
  private initialized: Promise<void> | null = null;
  private closed = false;

  constructor(opts: PostgresEventStoreOptions) {
    this.url = opts.url;
    this.runId = opts.runId ?? "run_pg";
    this.pool = new Pool({ connectionString: opts.url });
  }

  private async ensureInit(): Promise<void> {
    if (this.initialized !== null) return this.initialized;
    this.initialized = (async () => {
      for (const stmt of SCHEMA) {
        await this.pool.query(stmt);
      }
      const r = await this.pool.query<{ value: string }>(
        "SELECT value FROM meta WHERE key = 'schema_version'",
      );
      if (r.rowCount === 0) {
        await this.pool.query(
          "INSERT INTO meta(key, value) VALUES ('schema_version', $1)",
          [SCHEMA_VERSION],
        );
      } else if (r.rows[0]!.value !== SCHEMA_VERSION) {
        throw new SchemaVersionMismatch(
          `postgres store schema_version '${r.rows[0]!.value}' does not match this build's expected '${SCHEMA_VERSION}'`,
          {
            whatFailed: `The Postgres store records schema_version='${r.rows[0]!.value}' but this build expects '${SCHEMA_VERSION}'.`,
            why: "Schema versions identify the on-disk layout. Mismatch means the store was written by a different activegraph build.",
            howToFix: `Upgrade or downgrade activegraph to a build that uses schema_version='${r.rows[0]!.value}', or migrate the run.`,
            context: { recorded: r.rows[0]!.value, expected: SCHEMA_VERSION },
          },
        );
      }
    })();
    return this.initialized;
  }

  async append(event: Event): Promise<void> {
    await this.ensureInit();
    try {
      await this.pool.query(
        `INSERT INTO events(id, type, actor, payload, frame_id, caused_by, timestamp, run_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          event.id,
          event.type,
          event.actor,
          JSON.stringify(event.payload),
          event.frameId,
          event.causedBy,
          event.timestamp,
          this.runId,
        ],
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/duplicate key|unique constraint/i.test(msg)) {
        throw new DuplicateEventError(`duplicate event id: ${event.id}`, {
          whatFailed: `Event id '${event.id}' already exists in run '${this.runId}'.`,
          why: "Event ids are unique within a run.",
          howToFix: "Use IDGen to generate event ids.",
          context: { event_id: event.id, run_id: this.runId },
        });
      }
      throw err;
    }
  }

  iterEvents(opts: IterEventsOptions = {}): AsyncIterable<Event> {
    const self = this;
    return {
      [Symbol.asyncIterator]: async function* () {
        await self.ensureInit();
        let afterSeq: bigint | null = null;
        let untilSeq: bigint | null = null;
        if (opts.after !== undefined) {
          afterSeq = await self.seqOfOrThrow(opts.after, "iterEvents({ after })");
        }
        if (opts.until !== undefined) {
          untilSeq = await self.seqOfOrThrow(opts.until, "iterEvents({ until })");
        }
        const wheres = ["run_id = $1"];
        const params: unknown[] = [self.runId];
        if (afterSeq !== null) {
          params.push(afterSeq.toString());
          wheres.push(`seq > $${params.length}`);
        }
        if (untilSeq !== null) {
          params.push(untilSeq.toString());
          wheres.push(`seq <= $${params.length}`);
        }
        const r = await self.pool.query<EventRow>(
          `SELECT id, type, actor, payload, frame_id, caused_by, timestamp, seq
           FROM events WHERE ${wheres.join(" AND ")} ORDER BY seq ASC`,
          params,
        );
        for (const row of r.rows) yield self.rowToEvent(row);
      },
    };
  }

  async getEvent(eventId: string): Promise<Event | null> {
    await this.ensureInit();
    const r = await this.pool.query<EventRow>(
      `SELECT id, type, actor, payload, frame_id, caused_by, timestamp, seq
       FROM events WHERE run_id = $1 AND id = $2`,
      [this.runId, eventId],
    );
    if (r.rowCount === 0) return null;
    return this.rowToEvent(r.rows[0]!);
  }

  async count(): Promise<number> {
    await this.ensureInit();
    const r = await this.pool.query<{ n: string }>(
      "SELECT COUNT(*)::text AS n FROM events WHERE run_id = $1",
      [this.runId],
    );
    return Number(r.rows[0]!.n);
  }

  async truncateAfter(eventId: string): Promise<void> {
    await this.ensureInit();
    const seq = await this.seqOfOrThrow(eventId, "truncateAfter(eventId)");
    await this.pool.query("DELETE FROM events WHERE run_id = $1 AND seq > $2", [
      this.runId,
      seq.toString(),
    ]);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.pool.end();
  }

  private async seqOfOrThrow(eventId: string, where: string): Promise<bigint> {
    const r = await this.pool.query<{ seq: string }>(
      "SELECT seq FROM events WHERE run_id = $1 AND id = $2",
      [this.runId, eventId],
    );
    if (r.rowCount === 0) {
      throw new EventNotFoundError(`event '${eventId}' not found in run '${this.runId}'`, {
        whatFailed: `${where} referenced event '${eventId}' but no event with that id exists in run '${this.runId}'.`,
        why: "Event ids are the framework's addressing primitive; an unknown id is a caller bug.",
        howToFix: "Verify the event id against the events actually in this run.",
        context: { event_id: eventId, run_id: this.runId, where },
      });
    }
    return BigInt(r.rows[0]!.seq);
  }

  private rowToEvent(row: EventRow): Event {
    const payload =
      typeof row.payload === "string"
        ? (JSON.parse(row.payload) as Record<string, unknown>)
        : (row.payload as Record<string, unknown>);
    return makeEvent({
      id: row.id,
      type: row.type,
      payload,
      actor: row.actor,
      frameId: row.frame_id,
      causedBy: row.caused_by,
      timestamp: row.timestamp,
    });
  }
}
