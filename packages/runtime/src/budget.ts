// Hard limits on a run. When any limit is hit the runtime stops
// gracefully and emits runtime.budget_exhausted.
//
// `maxCostUsd` is tracked separately because it composes from many
// per-LLM-call sub-cent floats; the rest are integer counters.

export interface BudgetLimits {
  maxEvents?: number;
  maxBehaviorCalls?: number;
  maxLlmCalls?: number;
  maxToolCalls?: number;
  maxPatches?: number;
  maxDepth?: number;
  maxSeconds?: number;
  maxCostUsd?: number;
}

const KEYS = [
  "maxEvents",
  "maxBehaviorCalls",
  "maxLlmCalls",
  "maxToolCalls",
  "maxPatches",
  "maxDepth",
  "maxSeconds",
  "maxCostUsd",
] as const;

type BudgetKey = (typeof KEYS)[number];

export class Budget {
  readonly limits: Record<BudgetKey, number>;
  readonly used: Record<BudgetKey, number>;
  private start: number | null = null;
  private exhausted: BudgetKey | null = null;
  private costUsed = 0;

  constructor(limits: BudgetLimits = {}) {
    const lim: Record<BudgetKey, number> = {} as Record<BudgetKey, number>;
    const u: Record<BudgetKey, number> = {} as Record<BudgetKey, number>;
    for (const k of KEYS) {
      const v = limits[k];
      lim[k] = v ?? Number.POSITIVE_INFINITY;
      u[k] = 0;
    }
    this.limits = lim;
    this.used = u;
  }

  startTimer(): void {
    this.start = performance.now();
  }

  consume(key: BudgetKey, amount = 1): void {
    this.used[key] = (this.used[key] ?? 0) + amount;
  }

  addCost(amountUsd: number): void {
    this.costUsed += amountUsd;
    this.used.maxCostUsd = this.costUsed;
  }

  costRemaining(prospectiveUsd: number): boolean {
    if (this.limits.maxCostUsd === Number.POSITIVE_INFINITY) return true;
    return this.costUsed + prospectiveUsd <= this.limits.maxCostUsd;
  }

  costRemainingAmount(): number | null {
    if (this.limits.maxCostUsd === Number.POSITIVE_INFINITY) return null;
    return Math.max(0, this.limits.maxCostUsd - this.costUsed);
  }

  exhaustedBy(): BudgetKey | null {
    return this.exhausted;
  }

  remaining(): boolean {
    for (const k of KEYS) {
      const limit = this.limits[k];
      if (limit === Number.POSITIVE_INFINITY) continue;
      if (k === "maxSeconds") {
        if (this.start === null) continue;
        if ((performance.now() - this.start) / 1000 >= limit) {
          this.exhausted = k;
          return false;
        }
        continue;
      }
      if (this.used[k] >= limit) {
        this.exhausted = k;
        return false;
      }
    }
    return true;
  }

  snapshot(): {
    used: Record<BudgetKey, number>;
    limits: Record<BudgetKey, number | null>;
    costUsedUsd: number;
    costLimitUsd: number | null;
  } {
    const limitsOut: Record<BudgetKey, number | null> = {} as Record<BudgetKey, number | null>;
    for (const k of KEYS) {
      limitsOut[k] = this.limits[k] === Number.POSITIVE_INFINITY ? null : this.limits[k];
    }
    return {
      used: { ...this.used },
      limits: limitsOut,
      costUsedUsd: this.costUsed,
      costLimitUsd:
        this.limits.maxCostUsd === Number.POSITIVE_INFINITY ? null : this.limits.maxCostUsd,
    };
  }
}
