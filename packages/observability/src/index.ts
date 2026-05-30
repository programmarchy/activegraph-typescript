// @activegraph/observability — structured logging, metrics, migrate.
//
// pino-backed logger, prom-client-backed metrics, plus a migration
// primitive that copies events between EventStores.

import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from "prom-client";
import { pino, type Logger as PinoLogger } from "pino";

import type { Event } from "@activegraph/core";
import type { EventStore } from "@activegraph/store-memory";

// --- metrics -------------------------------------------------------------

export interface Metrics {
  increment(name: string, value?: number, tags?: Record<string, string>): void;
  observe(name: string, value: number, tags?: Record<string, string>): void;
}

export class NoOpMetrics implements Metrics {
  increment(_name: string, _value = 1, _tags: Record<string, string> = {}): void {
    // no-op
  }
  observe(_name: string, _value: number, _tags: Record<string, string> = {}): void {
    // no-op
  }
}

export interface PrometheusMetricsOptions {
  /** Existing registry; defaults to a fresh one. */
  registry?: Registry;
  /** Whether to bind process/runtime default metrics. */
  collectDefaults?: boolean;
}

/**
 * prom-client-backed Metrics implementation.
 *
 * Counters/histograms are created on demand. Tag keys become Prom
 * labels; tags-per-name must stay consistent (Prom requires a stable
 * label set per metric). The instance keeps a registry of created
 * metrics so repeat calls reuse the existing series.
 */
export class PrometheusMetrics implements Metrics {
  readonly registry: Registry;
  private readonly counters = new Map<string, Counter<string>>();
  private readonly histograms = new Map<string, Histogram<string>>();

  constructor(opts: PrometheusMetricsOptions = {}) {
    this.registry = opts.registry ?? new Registry();
    if (opts.collectDefaults === true) {
      collectDefaultMetrics({ register: this.registry });
    }
  }

  increment(name: string, value = 1, tags: Record<string, string> = {}): void {
    const labelNames = Object.keys(tags).sort();
    let counter = this.counters.get(name);
    if (counter === undefined) {
      counter = new Counter({
        name,
        help: name,
        labelNames,
        registers: [this.registry],
      });
      this.counters.set(name, counter);
    }
    counter.inc(tags, value);
  }

  observe(name: string, value: number, tags: Record<string, string> = {}): void {
    const labelNames = Object.keys(tags).sort();
    let hist = this.histograms.get(name);
    if (hist === undefined) {
      hist = new Histogram({
        name,
        help: name,
        labelNames,
        registers: [this.registry],
      });
      this.histograms.set(name, hist);
    }
    hist.observe(tags, value);
  }

  async serialize(): Promise<string> {
    return this.registry.metrics();
  }
}

export { Counter, Gauge, Histogram, Registry };

// --- structured logging --------------------------------------------------

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export interface LoggerOptions {
  level?: LogLevel;
  /** Output JSON instead of pretty. Default true. */
  json?: boolean;
}

export interface Logger {
  trace(obj: Record<string, unknown>, msg?: string): void;
  debug(obj: Record<string, unknown>, msg?: string): void;
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
}

let activeLogger: PinoLogger = pino({ level: "info" });

export function configureLogging(opts: LoggerOptions = {}): Logger {
  const level = opts.level ?? "info";
  const json = opts.json ?? true;
  activeLogger = json
    ? pino({ level })
    : pino({
        level,
        transport: { target: "pino-pretty", options: { colorize: true } },
      });
  return activeLogger;
}

export function getLogger(): Logger {
  return activeLogger;
}

// --- runtime status (shape) ---------------------------------------------

export interface RuntimeStatus {
  runId: string;
  eventCount: number;
  queueDepth: number;
  delayedCount?: number;
  tick?: number;
  budget: {
    used: Record<string, number>;
    limits: Record<string, number | null>;
    costUsedUsd: number;
    costLimitUsd: number | null;
  };
}

// --- migrate primitive --------------------------------------------------

export interface MigrationRunReport {
  runId: string;
  eventsCopied: number;
  ok: boolean;
  error?: string;
}

export interface MigrationReport {
  runs: MigrationRunReport[];
  ok: boolean;
}

export interface MigrateOptions {
  from: EventStore;
  to: EventStore;
}

/**
 * Copy every event from `from` into `to`, in order. Returns a report.
 *
 * Currently single-run only (the EventStore interface is per-run);
 * multi-run migrate over a path-level store is a future extension.
 */
export async function migrate(opts: MigrateOptions): Promise<MigrationReport> {
  const report: MigrationRunReport = {
    runId: opts.from.runId,
    eventsCopied: 0,
    ok: true,
  };
  try {
    for await (const ev of opts.from.iterEvents() as AsyncIterable<Event>) {
      await opts.to.append(ev);
      report.eventsCopied += 1;
    }
  } catch (err) {
    report.ok = false;
    report.error = err instanceof Error ? err.message : String(err);
  }
  return { runs: [report], ok: report.ok };
}
