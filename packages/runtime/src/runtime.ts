// Runtime façade: event-driven loop, behavior dispatch, budget, replay,
// fork, persistence wiring.
//
// Public API (stable across the Python and TS implementations):
//   const runtime = new Runtime(graph, { budget: { maxEvents: 200 } });
//   await runtime.runGoal("Evaluate this startup idea");
//   runtime.printTrace();
//
// Async-first: behavior handlers may be sync or async; runGoal awaits each
// invocation in turn. The dispatch order is FIFO over the event queue.

import {
  type Event,
  type Frame,
  Graph,
  Trace,
  View,
  makeEvent,
  evaluateWhere,
} from "@activegraph/core";

import type {
  AnyBehavior,
  Behavior,
  LLMBehavior,
  RelationBehavior,
} from "./behaviors.js";
import { getRegistry } from "./behaviors.js";
import { Budget, type BudgetLimits } from "./budget.js";
import type { RuntimeContext } from "./context.js";
import { BehaviorFailure, InvalidArgumentType } from "./errors.js";
import type { MatchHandle } from "./patterns.js";
import { buildView } from "./view-builder.js";

export interface RuntimeOptions {
  /** Explicit behavior list. If omitted, the global registry is used. */
  behaviors?: AnyBehavior[];
  budget?: BudgetLimits | Budget;
  frame?: Frame;
  /**
   * Bind an EventStore as the durability target. When set, every emitted
   * event is appended to the store. Optional.
   */
  store?: { append: (event: Event) => void | Promise<void> } | null;
}

interface ScheduledEntry {
  behaviorIndex: number;
  triggeringEventId: string;
  fireAtTick: number;
  scheduledEventId: string;
}

/**
 * Runtime-internal event types that don't get re-enqueued for behavior
 * matching. Without this filter a pattern-only or `on:`-less behavior
 * would match the lifecycle events it just emitted, infinite-looping.
 * pack.loaded is intentionally NOT suppressed — pack-aware behaviors
 * subscribe to it.
 */
const META_PREFIXES = [
  "behavior.",
  "relation_behavior.",
  "runtime.",
  "llm.",
  "tool.",
  "pattern.",
  "approval.",
];

function isRuntimeMetaEvent(type: string): boolean {
  for (const p of META_PREFIXES) {
    if (type.startsWith(p)) return true;
  }
  return false;
}

export class Runtime {
  readonly graph: Graph;
  readonly budget: Budget;
  readonly behaviors: AnyBehavior[];
  frame: Frame | null;

  private queue: Event[] = [];
  private listenerInstalled = false;
  /**
   * Monotonic counter that increments once per event pulled from the
   * dispatch queue. activateAfter delays fire when tick reaches the
   * entry's `fireAtTick`.
   */
  private tick = 0;
  private delayed: ScheduledEntry[] = [];
  private exhausted = false;

  constructor(graph: Graph, opts: RuntimeOptions = {}) {
    if (!(graph instanceof Graph)) {
      throw new InvalidArgumentType("Runtime(graph): expected a Graph instance", {
        whatFailed: `The first argument to new Runtime must be a Graph instance; got ${typeof graph}.`,
        why: "Every Runtime is bound to exactly one Graph for the lifetime of a run.",
        howToFix: "Construct the Graph first, then pass it into new Runtime(graph, opts).",
      });
    }
    this.graph = graph;
    this.budget = opts.budget instanceof Budget ? opts.budget : new Budget(opts.budget ?? {});
    this.behaviors = opts.behaviors ?? [...getRegistry()];
    this.frame = opts.frame ?? null;
    if (opts.store) graph.attachStore(opts.store);
    this.installListener();
  }

  private installListener(): void {
    if (this.listenerInstalled) return;
    this.graph.addListener((e) => {
      if (isRuntimeMetaEvent(e.type)) return;
      this.queue.push(e);
    });
    this.listenerInstalled = true;
  }

  /** Seed the run with a goal.created event and drive the queue to idle. */
  async runGoal(goal: string, opts: { actor?: string } = {}): Promise<void> {
    this.budget.startTimer();
    const actor = opts.actor ?? "user";
    const goalEvent = makeEvent({
      id: this.graph.ids.event(),
      type: "goal.created",
      payload: { goal },
      actor,
      frameId: this.frame?.id ?? null,
      causedBy: null,
      timestamp: this.graph.clock.now(),
    });
    this.graph.emit(goalEvent);
    await this.drain();
  }

  /** Alias for {@link drain} — drives the queue until idle or budget exhausted. */
  async runUntilIdle(): Promise<void> {
    await this.drain();
  }

  /** Drive the queue until no behaviors match a remaining event or budget runs out. */
  async drain(): Promise<void> {
    while (this.queue.length > 0 || this.delayed.length > 0) {
      if (this.exhausted) return;
      if (this.queue.length === 0 && this.delayed.length > 0) {
        // No queued events but delayed entries exist. Bump the tick so
        // entries scheduled at "0 from now" fire when the queue is
        // already empty; otherwise idle out.
        if (!this.fireDueDelayed()) break;
        continue;
      }
      if (!this.budget.remaining()) {
        this.emitBudgetExhausted();
        return;
      }
      const event = this.queue.shift()!;
      this.budget.consume("maxEvents");
      this.tick += 1;
      await this.dispatch(event);
      if (this.exhausted) return;
      await this.drainDueDelayed();
    }
    if (!this.exhausted) this.emitIdle();
  }

  private async dispatch(event: Event): Promise<void> {
    for (let i = 0; i < this.behaviors.length; i++) {
      const behavior = this.behaviors[i]!;
      if (!this.matchesEventGate(behavior, event)) continue;
      if (!this.budget.remaining()) {
        this.emitBudgetExhausted();
        return;
      }

      // Pattern gate: run the compiled matcher. Empty → skip (the
      // behavior subscribed via pattern but no current graph shape
      // matches).
      let matches: MatchHandle[] = [];
      if (behavior.matcher !== null) {
        matches = behavior.matcher.matches({ event, graph: this.graph });
        if (matches.length === 0) continue;
      }

      // activateAfter gate: defer.
      if (behavior.activateAfter !== null && behavior.activateAfter > 0) {
        this.scheduleDelayed(behavior, i, event);
        continue;
      }

      if (matches.length > 0) {
        this.emitPatternMatched(behavior, event, matches);
      }

      await this.fireOne(behavior, event, matches);
    }
  }

  private async fireOne(
    behavior: AnyBehavior,
    event: Event,
    matches: MatchHandle[],
  ): Promise<void> {
    if (behavior.kind === "relationBehavior") {
      await this.fireRelationBehavior(behavior, event, matches);
    } else if (behavior.kind === "behavior") {
      await this.fireBehavior(behavior, event, matches);
    } else {
      await this.fireLLMBehavior(behavior, event, matches);
    }
  }

  private matchesEventGate(behavior: AnyBehavior, event: Event): boolean {
    // on= filter. Empty `on` + pattern means "pattern-only behavior" —
    // pattern gate runs every event.
    if (behavior.on.length > 0 && !behavior.on.includes(event.type)) return false;
    if (behavior.where !== null && !evaluateWhere(behavior.where, event.payload)) {
      return false;
    }
    return true;
  }

  private buildCtx(
    behavior: AnyBehavior,
    event: Event,
    matches: MatchHandle[],
  ): RuntimeContext {
    const view: View = buildView(behavior, event, this.graph);
    const self = this;
    return {
      clock: this.graph.clock,
      view,
      frame: this.frame,
      triggeringEvent: event,
      matches,
      emit(type: string, payload: Record<string, unknown> = {}): void {
        self.graph.emit(
          makeEvent({
            id: self.graph.ids.event(),
            type,
            payload,
            actor: behavior.name,
            frameId: self.frame?.id ?? null,
            causedBy: event.id,
            timestamp: self.graph.clock.now(),
          }),
        );
      },
    };
  }

  private async fireBehavior(
    behavior: Behavior,
    event: Event,
    matches: MatchHandle[],
  ): Promise<void> {
    const ctx = this.buildCtx(behavior, event, matches);
    const started = this.emitInfrastructureEvent(
      "behavior.started",
      { behavior: behavior.name, triggering_event_type: event.type },
      event,
    );
    this.budget.consume("maxBehaviorCalls");
    const objsBefore = this.graph.allObjects().length;
    const relsBefore = this.graph.allRelations().length;
    try {
      await behavior.handler(event, this.graph, ctx);
      this.emitInfrastructureEvent(
        "behavior.completed",
        {
          behavior: behavior.name,
          objects_created: this.graph.allObjects().length - objsBefore,
          relations_created: this.graph.allRelations().length - relsBefore,
        },
        started,
      );
    } catch (err) {
      this.emitBehaviorFailed(behavior.name, err, started);
    }
  }

  private async fireRelationBehavior(
    behavior: RelationBehavior,
    event: Event,
    matches: MatchHandle[],
  ): Promise<void> {
    const rels = this.graph.relations({ type: behavior.relationType });
    if (rels.length === 0) return;
    for (const relation of rels) {
      const ctx = this.buildCtx(behavior, event, matches);
      const started = this.emitInfrastructureEvent(
        "relation_behavior.started",
        {
          behavior: behavior.name,
          relation_type: behavior.relationType,
          triggering_event_type: event.type,
        },
        event,
      );
      this.budget.consume("maxBehaviorCalls");
      try {
        await behavior.handler(relation, event, this.graph, ctx);
        this.emitInfrastructureEvent(
          "behavior.completed",
          { behavior: behavior.name },
          started,
        );
      } catch (err) {
        this.emitBehaviorFailed(behavior.name, err, started);
      }
    }
  }

  private async fireLLMBehavior(
    _behavior: LLMBehavior<unknown>,
    _event: Event,
    _matches: MatchHandle[],
  ): Promise<void> {
    // Phase 5: full LLM dispatch lives in @activegraph/llm. The
    // placeholder consumes the budget so runs with registered LLM
    // behaviors still terminate predictably in core-only installs.
    this.budget.consume("maxLlmCalls");
  }

  // --- activateAfter scheduling --------------------------------------------

  private scheduleDelayed(behavior: AnyBehavior, behaviorIndex: number, event: Event): void {
    const fireAtTick = this.tick + (behavior.activateAfter ?? 0);
    const scheduled = this.emitInfrastructureEvent(
      "behavior.scheduled",
      {
        behavior: behavior.name,
        event_id: event.id,
        activate_after: behavior.activateAfter,
        fire_at_tick: fireAtTick,
        current_tick: this.tick,
      },
      event,
    );
    this.delayed.push({
      behaviorIndex,
      triggeringEventId: event.id,
      fireAtTick,
      scheduledEventId: scheduled.id,
    });
  }

  private async drainDueDelayed(): Promise<void> {
    while (this.fireDueDelayed()) {
      // fireDueDelayed pops one due entry and fires it synchronously
      // (it appends to the queue if the behavior emits). Loop until
      // none are due at the current tick.
      await Promise.resolve();
    }
  }

  /**
   * Pop and fire one due delayed entry. Returns true if an entry fired,
   * false if none were due.
   */
  private fireDueDelayed(): boolean {
    const dueIdx = this.delayed.findIndex((e) => e.fireAtTick <= this.tick);
    if (dueIdx === -1) return false;
    const entry = this.delayed.splice(dueIdx, 1)[0]!;
    if (!this.budget.remaining()) {
      this.emitBudgetExhausted();
      return false;
    }
    const behavior = this.behaviors[entry.behaviorIndex];
    if (!behavior) return true;
    const ev = this.graph.events.find((e) => e.id === entry.triggeringEventId);
    if (!ev) return true;
    if (behavior.where !== null && !evaluateWhere(behavior.where, ev.payload)) {
      // Silent skip — the behavior.scheduled event in the trace plus
      // absence of behavior.started is sufficient evidence.
      return true;
    }
    let matches: MatchHandle[] = [];
    if (behavior.matcher !== null) {
      matches = behavior.matcher.matches({ event: ev, graph: this.graph });
      if (matches.length === 0) return true;
    }
    if (matches.length > 0) this.emitPatternMatched(behavior, ev, matches);
    // Fire-and-defer: do not await here (we're in a sync loop). Errors
    // are reported via behavior.failed events.
    void this.fireOne(behavior, ev, matches);
    return true;
  }

  // --- infrastructure-event emitters ---------------------------------------

  private emitInfrastructureEvent(
    type: string,
    payload: Record<string, unknown>,
    causedBy: Event,
  ): Event {
    return this.graph.emit(
      makeEvent({
        id: this.graph.ids.event(),
        type,
        payload,
        actor: "runtime",
        frameId: this.frame?.id ?? null,
        causedBy: causedBy.id,
        timestamp: this.graph.clock.now(),
      }),
    );
  }

  private emitPatternMatched(
    behavior: AnyBehavior,
    event: Event,
    matches: MatchHandle[],
  ): void {
    this.emitInfrastructureEvent(
      "pattern.matched",
      {
        behavior: behavior.name,
        matches_count: matches.length,
        bindings: matches.map((m) => ({ ...m.bindings })),
      },
      event,
    );
  }

  private emitBehaviorFailed(name: string, err: unknown, started: Event): void {
    const e = err instanceof Error ? err : new Error(String(err));
    this.graph.emit(
      makeEvent({
        id: this.graph.ids.event(),
        type: "behavior.failed",
        payload: {
          behavior: name,
          exception_type: e.constructor.name,
          message: e.message,
          stack: e.stack ?? "",
        },
        actor: "runtime",
        frameId: this.frame?.id ?? null,
        causedBy: started.id,
        timestamp: this.graph.clock.now(),
      }),
    );
    // Behaviors failing is an event, not a thrown exception — see CONTRACT.
    void BehaviorFailure;
  }

  private emitIdle(): void {
    this.graph.emit(
      makeEvent({
        id: this.graph.ids.event(),
        type: "runtime.idle",
        payload: {},
        actor: "runtime",
        frameId: this.frame?.id ?? null,
        causedBy: null,
        timestamp: this.graph.clock.now(),
      }),
    );
    this.queue.length = 0;
  }

  private emitBudgetExhausted(): void {
    if (this.exhausted) return;
    this.exhausted = true;
    const exhaustedBy = this.budget.exhaustedBy() ?? "unknown";
    this.graph.emit(
      makeEvent({
        id: this.graph.ids.event(),
        type: "runtime.budget_exhausted",
        payload: { exhausted_by: exhaustedBy },
        actor: "runtime",
        frameId: this.frame?.id ?? null,
        causedBy: null,
        timestamp: this.graph.clock.now(),
      }),
    );
    this.queue.length = 0;
    this.delayed.length = 0;
  }

  // --- trace shortcut ----

  trace(): Trace {
    return new Trace(this.graph);
  }

  printTrace(): void {
    this.trace().print();
  }

  // --- status ----

  status(): {
    runId: string;
    eventCount: number;
    queueDepth: number;
    delayedCount: number;
    tick: number;
    budget: ReturnType<Budget["snapshot"]>;
  } {
    return {
      runId: this.graph.runId,
      eventCount: this.graph.events.length,
      queueDepth: this.queue.length,
      delayedCount: this.delayed.length,
      tick: this.tick,
      budget: this.budget.snapshot(),
    };
  }
}
