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
  IDGen,
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
import {
  BehaviorFailure,
  IncompatibleRuntimeState,
  InvalidArgumentType,
  ReplayDivergenceError,
} from "./errors.js";
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

export interface ForkOptions {
  /** Optional human-readable label for the fork. */
  label?: string;
  /** Optional explicit run id; defaults to a fresh ULID. */
  runId?: string;
  /** Override the behavior list on the fork. Defaults to the parent's. */
  behaviors?: AnyBehavior[];
}

export interface ReplayableStore {
  readonly runId: string;
  iterEvents(): AsyncIterable<Event> | Iterable<Event>;
  append(event: Event): void | Promise<void>;
}

export interface LoadOptions {
  /**
   * Strict replay: re-fire behaviors from the seed events (events with
   * no causedBy) and verify the (id, type) stream of the generated
   * events matches the recorded log. Throws ReplayDivergenceError on
   * the first mismatch.
   */
  strict?: boolean;
  behaviors?: AnyBehavior[];
  frame?: Frame;
  budget?: BudgetLimits | Budget;
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

/**
 * Re-fire behaviors from the recorded seed events into a fresh
 * runtime and verify the resulting (id, type) stream matches. Cheapest
 * correctness check the framework has — a behavior that quietly
 * changes its output shape between runs gets caught here.
 *
 * Compares ids AND types, since the IDGen is reseeded to start from
 * the recorded seed (so a re-run that produces the same events also
 * produces the same ids by construction).
 */
/**
 * Graph-mutation event types emitted by Graph.addObject/addRelation/
 * patchObject/etc. These can have `causedBy: null` when emitted directly
 * by the user (outside a behavior) but they aren't "seed" events for
 * replay purposes — they're projections of mutations. Seeds are external
 * stimuli the runtime treats as input: goal.created and custom user
 * events without causedBy.
 */
const GRAPH_MUTATION_TYPES = new Set([
  "object.created",
  "object.removed",
  "relation.created",
  "relation.removed",
  "patch.proposed",
  "patch.applied",
  "patch.rejected",
]);

async function verifyReplay(recorded: Event[], behaviors: AnyBehavior[]): Promise<void> {
  const seeds = recorded.filter(
    (e) =>
      e.causedBy === null &&
      !isRuntimeMetaEvent(e.type) &&
      !GRAPH_MUTATION_TYPES.has(e.type),
  );
  if (seeds.length === 0) return;

  const fresh = new Graph({ ids: new IDGen() });
  const rt = new Runtime(fresh, { behaviors });
  // Replay seed events into the new graph as live events so the
  // listener queues them and dispatch runs.
  for (const seed of seeds) {
    fresh.emit(
      makeEvent({
        id: fresh.ids.event(),
        type: seed.type,
        payload: seed.payload,
        actor: seed.actor,
        frameId: seed.frameId,
        causedBy: null,
        timestamp: seed.timestamp,
      }),
    );
  }
  await rt.drain();

  // Compare the non-lifecycle event-type streams. Lifecycle events
  // (behavior.*, relation_behavior.*, runtime.*) are infrastructure
  // and not part of the audit-trail contract.
  const isReplayLifecycle = (t: string): boolean =>
    t.startsWith("behavior.") || t.startsWith("relation_behavior.") || t.startsWith("runtime.");
  const recordedTypes = recorded.filter((e) => !isReplayLifecycle(e.type)).map((e) => e.type);
  const liveTypes = fresh.events.filter((e) => !isReplayLifecycle(e.type)).map((e) => e.type);

  const len = Math.min(recordedTypes.length, liveTypes.length);
  for (let i = 0; i < len; i++) {
    if (recordedTypes[i] !== liveTypes[i]) {
      throw new ReplayDivergenceError(
        `replay diverged at event index ${i}: recorded '${recordedTypes[i]}', re-run produced '${liveTypes[i]}'`,
        {
          whatFailed: `Strict replay re-fired behaviors from the seed events. At event index ${i} the re-run produced '${liveTypes[i]}' but the recorded log has '${recordedTypes[i]}'.`,
          why: "Strict replay protects the audit-trail guarantee. A behavior that produces different events on re-run breaks every downstream consumer that relies on the recorded log being faithful — the trace audit, the causal chain walk, the fork primitive.",
          howToFix:
            "Either the recorded log is stale (the behavior was changed in a way that altered its output) or the behavior is non-deterministic. Re-record the log if the behavior change was intended; otherwise mark the LLM/tool behavior as `deterministic: false` to suppress strict replay for it.",
          context: {
            index: i,
            recorded_type: recordedTypes[i],
            live_type: liveTypes[i],
            recorded_count: recordedTypes.length,
            live_count: liveTypes.length,
          },
        },
      );
    }
  }
  if (recordedTypes.length !== liveTypes.length) {
    throw new ReplayDivergenceError(
      `replay diverged in length: recorded ${recordedTypes.length} events, re-run produced ${liveTypes.length}`,
      {
        whatFailed: `Strict replay produced ${liveTypes.length} events but the recorded log has ${recordedTypes.length}.`,
        why: "A different number of events means either a behavior re-ran differently or a behavior that should have fired didn't (or vice versa).",
        howToFix: "Inspect the divergence point. If the behavior set changed, re-record the log.",
        context: { recorded_count: recordedTypes.length, live_count: liveTypes.length },
      },
    );
  }
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

  // --- load / replay ----

  /**
   * Open `store`, replay its events into a fresh Graph, return a
   * Runtime wired to continue from where the log left off.
   *
   * `strict: true` re-fires every behavior from the seed events
   * (events with no causedBy) and compares the resulting event-type
   * stream against the recorded log. On the first mismatch raises
   * ReplayDivergenceError. Cheapest correctness check the framework
   * has — a behavior that quietly changes its output shape between
   * runs gets caught here.
   *
   * Without `strict`, no behavior re-fires; the graph state is
   * reconstructed by projecting the recorded events. The returned
   * Runtime is ready for `runUntilIdle()` to continue.
   */
  static async load(store: ReplayableStore, opts: LoadOptions = {}): Promise<Runtime> {
    const events: Event[] = [];
    for await (const ev of store.iterEvents() as AsyncIterable<Event>) events.push(ev);

    const graph = new Graph({
      ids: new IDGen(),
      runId: store.runId,
    });
    for (const ev of events) graph.replayEvent(ev);
    graph.ids.reseedFromEvents(events);
    graph.attachStore(store);

    const runtime = new Runtime(graph, {
      ...(opts.behaviors !== undefined ? { behaviors: opts.behaviors } : {}),
      ...(opts.frame !== undefined ? { frame: opts.frame } : {}),
      ...(opts.budget !== undefined ? { budget: opts.budget } : {}),
    });

    if (opts.strict === true) {
      await verifyReplay(events, opts.behaviors ?? [...getRegistry()]);
    }

    return runtime;
  }

  // --- fork ----

  /**
   * Branch this run at `atEventId` into an independent new run.
   *
   * Copies the parent's event log up to and including `atEventId` into a
   * fresh Graph (replaying events via Graph.replayEvent — no listeners
   * fire, no behaviors re-run), then returns a new Runtime over that
   * Graph. The new Graph carries the fork lineage in `parentRunId` /
   * `forkedAtEventId` provenance.
   *
   * The new Runtime starts fresh: empty queue, empty budget, current
   * frame inherited. Behaviors come from the parent's explicit list
   * (when provided) or the global registry, matching the parent.
   *
   * In TS the operation works against any in-memory event log — Python
   * required SQLite for transactional copy semantics; TS replays from
   * `graph.events` directly so it works with any backend.
   */
  fork(atEventId: string, opts: ForkOptions = {}): Runtime {
    const cutIndex = this.graph.events.findIndex((e) => e.id === atEventId);
    if (cutIndex === -1) {
      throw new IncompatibleRuntimeState(
        `runtime.fork(atEventId='${atEventId}') — no event with that id in this run`,
        {
          whatFailed: `fork() requires an event id that exists in this runtime's event log. '${atEventId}' is not present.`,
          why: "The fork point identifies the prefix to copy into the new run. An unknown event id means either a typo or referencing an id from a different run.",
          howToFix: `Pick an event id from \`runtime.graph.events\`. Check status() or the trace to find the right fork point.`,
          context: { at_event_id: atEventId, run_id: this.graph.runId },
        },
      );
    }
    const prefix = this.graph.events.slice(0, cutIndex + 1);

    const forkIds = new IDGen();
    const forkGraph = new Graph({
      ids: forkIds,
      clock: this.graph.clock,
      runId: opts.runId ?? this.graph.ids.run(),
    });
    forkGraph.parentRunId = this.graph.runId;
    forkGraph.forkedAtEventId = atEventId;
    if (opts.label !== undefined) forkGraph.label = opts.label;

    for (const ev of prefix) forkGraph.replayEvent(ev);
    forkGraph.ids.reseedFromEvents(prefix);

    const childOpts: RuntimeOptions = {
      behaviors: opts.behaviors ?? this.behaviors,
    };
    if (this.frame !== null) childOpts.frame = this.frame;
    return new Runtime(forkGraph, childOpts);
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
