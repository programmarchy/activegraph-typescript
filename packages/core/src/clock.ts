// Clock abstraction. Behaviors get time via ctx.clock.

export interface Clock {
  /** ISO 8601 second-precision UTC timestamp with `Z` suffix. */
  now(): string;
}

/** Real wall-clock UTC. */
export class WallClock implements Clock {
  now(): string {
    return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  }
}

/** Always returns the same timestamp. For tests and snapshots. */
export class FrozenClock implements Clock {
  constructor(private readonly t: string = "2026-05-15T10:32:01Z") {}
  now(): string {
    return this.t;
  }
}

/**
 * Monotonically advances by `stepSeconds` on every call. For tests that
 * care about ordering but don't want wall-clock noise.
 */
export class TickingClock implements Clock {
  private t: Date;
  constructor(start: string = "2026-05-15T10:32:01Z", private readonly stepSeconds: number = 1) {
    this.t = new Date(start);
  }
  now(): string {
    const out = this.t.toISOString().replace(/\.\d{3}Z$/, "Z");
    this.t = new Date(this.t.getTime() + this.stepSeconds * 1000);
    return out;
  }
}
