// @activegraph/observability — structured logging, metrics, runtime status.
//
// pino + prom-client integrations land in Phase 6; these are typed shims
// so the umbrella package can re-export the surface today.

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

export class PrometheusMetrics implements Metrics {
  // TODO(phase-6): wire prom-client.
  increment(_name: string, _value = 1, _tags: Record<string, string> = {}): void {
    // no-op stub
  }
  observe(_name: string, _value: number, _tags: Record<string, string> = {}): void {
    // no-op stub
  }
}

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error";

export interface LoggerOptions {
  level?: LogLevel;
  /** Output JSON instead of pretty. Default true. */
  json?: boolean;
}

export function configureLogging(_opts: LoggerOptions = {}): void {
  // TODO(phase-6): wire pino.
}

export interface RuntimeStatus {
  runId: string;
  eventCount: number;
  queueDepth: number;
  budget: {
    used: Record<string, number>;
    limits: Record<string, number | null>;
    costUsedUsd: number;
    costLimitUsd: number | null;
  };
}

export interface MigrationRunReport {
  runId: string;
  eventsCopied: number;
  ok: boolean;
  error?: string;
}

export interface MigrationReport {
  fromUrl: string;
  toUrl: string;
  runs: MigrationRunReport[];
  ok: boolean;
}

export async function migrate(_opts: {
  from: string;
  to: string;
}): Promise<MigrationReport> {
  // TODO(phase-6): port the migration primitive.
  return { fromUrl: _opts.from, toUrl: _opts.to, runs: [], ok: true };
}
