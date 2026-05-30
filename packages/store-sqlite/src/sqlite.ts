// SQLite-backed EventStore (better-sqlite3).
//
// Schema is locked at version "1". WAL is on, synchronous=NORMAL — group
// fsync, crash-safe, ~25x faster than FULL for an event log workload.
//
//   events(seq INTEGER PRIMARY KEY AUTOINCREMENT,
//          id TEXT NOT NULL,
//          type TEXT NOT NULL,
//          actor TEXT,
//          payload TEXT NOT NULL,   -- JSON
//          frame_id TEXT,
//          caused_by TEXT,
//          timestamp TEXT NOT NULL,
//          run_id TEXT NOT NULL,
//          UNIQUE(id, run_id))
//
//   runs(run_id PRIMARY KEY, parent_run_id, forked_at_event_id, label,
//        created_at, goal, frame_id)
//
//   meta(key PRIMARY KEY, value)  -- carries schema_version
//
// `seq` is the projection ordering authority (wall clocks lie; AUTOINCREMENT
// cannot). A SQLiteEventStore is scoped to ONE run_id; multiple runs in the
// same file = multiple SQLiteEventStore instances over the same path.

import Database, { type Database as Db, type Statement } from "better-sqlite3";

import type { Event } from "@activegraph/core";
import { makeEvent } from "@activegraph/core";
import {
  DuplicateEventError,
  EventNotFoundError,
  type EventStore,
  type IterEventsOptions,
  SchemaVersionMismatch,
} from "@activegraph/store-memory";

const SCHEMA_VERSION = "1";

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL,
    type TEXT NOT NULL,
    actor TEXT,
    payload TEXT NOT NULL,
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

export interface SQLiteEventStoreOptions {
  /** Path to the SQLite database file. Use ":memory:" for transient stores. */
  path: string;
  runId?: string;
}

interface EventRow {
  id: string;
  type: string;
  actor: string | null;
  payload: string;
  frame_id: string | null;
  caused_by: string | null;
  timestamp: string;
  seq: number;
}

export class SQLiteEventStore implements EventStore {
  readonly runId: string;
  readonly path: string;
  private db: Db;
  private closed = false;

  private readonly insertStmt: Statement;
  private readonly seqOfStmt: Statement;
  private readonly iterAllStmt: Statement;
  private readonly iterAfterStmt: Statement;
  private readonly iterUntilStmt: Statement;
  private readonly iterBetweenStmt: Statement;
  private readonly getOneStmt: Statement;
  private readonly countStmt: Statement;
  private readonly deleteAfterStmt: Statement;

  constructor(opts: SQLiteEventStoreOptions) {
    this.path = opts.path;
    this.runId = opts.runId ?? "run_sqlite";
    this.db = new Database(this.path);
    this.ensureSchema();

    this.insertStmt = this.db.prepare(
      `INSERT INTO events(id, type, actor, payload, frame_id, caused_by, timestamp, run_id)
       VALUES (@id, @type, @actor, @payload, @frame_id, @caused_by, @timestamp, @run_id)`,
    );
    this.seqOfStmt = this.db.prepare(
      `SELECT seq FROM events WHERE run_id = ? AND id = ?`,
    );
    this.iterAllStmt = this.db.prepare(
      `SELECT id, type, actor, payload, frame_id, caused_by, timestamp, seq
       FROM events WHERE run_id = ? ORDER BY seq ASC`,
    );
    this.iterAfterStmt = this.db.prepare(
      `SELECT id, type, actor, payload, frame_id, caused_by, timestamp, seq
       FROM events WHERE run_id = ? AND seq > ? ORDER BY seq ASC`,
    );
    this.iterUntilStmt = this.db.prepare(
      `SELECT id, type, actor, payload, frame_id, caused_by, timestamp, seq
       FROM events WHERE run_id = ? AND seq <= ? ORDER BY seq ASC`,
    );
    this.iterBetweenStmt = this.db.prepare(
      `SELECT id, type, actor, payload, frame_id, caused_by, timestamp, seq
       FROM events WHERE run_id = ? AND seq > ? AND seq <= ? ORDER BY seq ASC`,
    );
    this.getOneStmt = this.db.prepare(
      `SELECT id, type, actor, payload, frame_id, caused_by, timestamp, seq
       FROM events WHERE run_id = ? AND id = ?`,
    );
    this.countStmt = this.db.prepare(
      `SELECT COUNT(*) AS n FROM events WHERE run_id = ?`,
    );
    this.deleteAfterStmt = this.db.prepare(
      `DELETE FROM events WHERE run_id = ? AND seq > ?`,
    );
  }

  private ensureSchema(): void {
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    for (const stmt of SCHEMA) this.db.exec(stmt);

    const row = this.db
      .prepare("SELECT value FROM meta WHERE key = 'schema_version'")
      .get() as { value: string } | undefined;
    if (row === undefined) {
      this.db
        .prepare("INSERT INTO meta(key, value) VALUES ('schema_version', ?)")
        .run(SCHEMA_VERSION);
    } else if (row.value !== SCHEMA_VERSION) {
      throw new SchemaVersionMismatch(
        `sqlite store schema_version '${row.value}' does not match this build's expected '${SCHEMA_VERSION}'`,
        {
          whatFailed: `The SQLite store records schema_version='${row.value}' in its meta table, but this activegraph build expects schema_version='${SCHEMA_VERSION}'.`,
          why: "Schema versions identify the on-disk layout. A mismatch means the store was written by a different activegraph build; reading it with the current schema risks misinterpreting columns or constraints.",
          howToFix: `Upgrade or downgrade activegraph to a build that uses schema_version='${row.value}', or migrate the run to a fresh store with the current build.`,
          context: { recorded: row.value, expected: SCHEMA_VERSION, path: this.path },
        },
      );
    }
  }

  append(event: Event): void {
    const payloadJSON = JSON.stringify(event.payload);
    try {
      this.insertStmt.run({
        id: event.id,
        type: event.type,
        actor: event.actor,
        payload: payloadJSON,
        frame_id: event.frameId,
        caused_by: event.causedBy,
        timestamp: event.timestamp,
        run_id: this.runId,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/UNIQUE constraint failed/.test(msg)) {
        throw new DuplicateEventError(`duplicate event id: ${event.id}`, {
          whatFailed: `An event with id '${event.id}' already exists in run '${this.runId}'.`,
          why: "Event ids are unique within a run. A duplicate would silently reroute references; the store refuses the append.",
          howToFix:
            "Use IDGen to generate event ids; duplicates almost always mean a test fixture is hand-constructing events with fixed ids.",
          context: { event_id: event.id, run_id: this.runId },
        });
      }
      throw err;
    }
  }

  *iterEvents(opts: IterEventsOptions = {}): Iterable<Event> {
    const afterSeq = opts.after !== undefined ? this.requireSeq(opts.after, "iterEvents({ after })") : null;
    const untilSeq = opts.until !== undefined ? this.requireSeq(opts.until, "iterEvents({ until })") : null;
    let rows: EventRow[];
    if (afterSeq !== null && untilSeq !== null) {
      rows = this.iterBetweenStmt.all(this.runId, afterSeq, untilSeq) as EventRow[];
    } else if (afterSeq !== null) {
      rows = this.iterAfterStmt.all(this.runId, afterSeq) as EventRow[];
    } else if (untilSeq !== null) {
      rows = this.iterUntilStmt.all(this.runId, untilSeq) as EventRow[];
    } else {
      rows = this.iterAllStmt.all(this.runId) as EventRow[];
    }
    for (const row of rows) yield this.rowToEvent(row);
  }

  getEvent(eventId: string): Event | null {
    const row = this.getOneStmt.get(this.runId, eventId) as EventRow | undefined;
    return row === undefined ? null : this.rowToEvent(row);
  }

  count(): number {
    const row = this.countStmt.get(this.runId) as { n: number };
    return row.n;
  }

  truncateAfter(eventId: string): void {
    const seq = this.requireSeq(eventId, "truncateAfter(eventId)");
    this.deleteAfterStmt.run(this.runId, seq);
  }

  close(): void {
    if (this.closed) return;
    this.db.close();
    this.closed = true;
  }

  private requireSeq(eventId: string, where: string): number {
    const row = this.seqOfStmt.get(this.runId, eventId) as { seq: number } | undefined;
    if (row === undefined) {
      throw new EventNotFoundError(`event '${eventId}' not found in run '${this.runId}'`, {
        whatFailed: `${where} referenced event '${eventId}' but no event with that id exists in run '${this.runId}'.`,
        why: "Event ids are the addressing primitive for the framework. A lookup against an unknown id is a bug in the caller.",
        howToFix: "Check the event id against the actual events in this run.",
        context: { event_id: eventId, run_id: this.runId, where },
      });
    }
    return row.seq;
  }

  private rowToEvent(row: EventRow): Event {
    return makeEvent({
      id: row.id,
      type: row.type,
      payload: JSON.parse(row.payload),
      actor: row.actor,
      frameId: row.frame_id,
      causedBy: row.caused_by,
      timestamp: row.timestamp,
    });
  }
}
