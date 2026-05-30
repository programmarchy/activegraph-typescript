// Runtime façade: event-driven loop, behavior dispatch, budget, replay,
// fork, persistence wiring.
//
// Public API (kept stable across the Python and TS implementations):
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

export class Runtime {
  readonly graph: Graph;
  readonly budget: Budget;
  readonly behaviors: AnyBehavior[];
  frame: Frame | null;

  private queue: Event[] = [];
  private listenerInstalled = false;

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
    this.graph.addListener((e) => this.queue.push(e));
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
    while (this.queue.length > 0) {
      if (!this.budget.remaining()) {
        this.emitBudgetExhausted();
        return;
      }
      const event = this.queue.shift()!;
      this.budget.consume("maxEvents");
      await this.dispatch(event);
    }
    this.emitIdle();
  }

  private async dispatch(event: Event): Promise<void> {
    for (const behavior of this.behaviors) {
      if (!this.matches(behavior, event)) continue;
      if (!this.budget.remaining()) {
        this.emitBudgetExhausted();
        return;
      }
      if (behavior.kind === "relationBehavior") {
        await this.fireRelationBehavior(behavior, event);
      } else if (behavior.kind === "behavior") {
        await this.fireBehavior(behavior, event);
      } else {
        await this.fireLLMBehavior(behavior, event);
      }
    }
  }

  private matches(behavior: AnyBehavior, event: Event): boolean {
    if (behavior.on.length > 0 && !behavior.on.includes(event.type)) return false;
    if (behavior.where !== null && !evaluateWhere(behavior.where, event.payload)) {
      return false;
    }
    return true;
  }

  private buildCtx(behavior: AnyBehavior, event: Event): RuntimeContext {
    const view: View = buildView(behavior, event, this.graph);
    const self = this;
    return {
      clock: this.graph.clock,
      view,
      frame: this.frame,
      triggeringEvent: event,
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

  private async fireBehavior(behavior: Behavior, event: Event): Promise<void> {
    const ctx = this.buildCtx(behavior, event);
    const started = this.emitInfrastructureEvent("behavior.started", {
      behavior: behavior.name,
      triggering_event_type: event.type,
    }, event);
    this.budget.consume("maxBehaviorCalls");
    const objsBefore = this.graph.allObjects().length;
    const relsBefore = this.graph.allRelations().length;
    try {
      await behavior.handler(event, this.graph, ctx);
      this.emitInfrastructureEvent("behavior.completed", {
        behavior: behavior.name,
        objects_created: this.graph.allObjects().length - objsBefore,
        relations_created: this.graph.allRelations().length - relsBefore,
      }, started);
    } catch (err) {
      this.emitBehaviorFailed(behavior.name, err, started);
    }
  }

  private async fireRelationBehavior(behavior: RelationBehavior, event: Event): Promise<void> {
    const ctx = this.buildCtx(behavior, event);
    const rels = this.graph.relations({ type: behavior.relationType });
    if (rels.length === 0) return;
    for (const relation of rels) {
      const started = this.emitInfrastructureEvent("relation_behavior.started", {
        behavior: behavior.name,
        relation_type: behavior.relationType,
        triggering_event_type: event.type,
      }, event);
      this.budget.consume("maxBehaviorCalls");
      try {
        await behavior.handler(relation, event, this.graph, ctx);
        this.emitInfrastructureEvent("behavior.completed", {
          behavior: behavior.name,
        }, started);
      } catch (err) {
        this.emitBehaviorFailed(behavior.name, err, started);
      }
    }
  }

  private async fireLLMBehavior(_behavior: LLMBehavior<unknown>, _event: Event): Promise<void> {
    // TODO(phase-5): full LLM dispatch lives in @activegraph/llm. This
    // placeholder lets registered LLM behaviors be no-ops in core-only
    // installations rather than crashing the run.
    this.budget.consume("maxLlmCalls");
  }

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
    // Behaviors failing is an event, not a thrown exception (events-not-
    // exceptions, see CONTRACT). To opt out, listen for behavior.failed
    // and rethrow yourself.
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
    // Discard the runtime.idle event the listener just enqueued —
    // nothing should dispatch off the terminal signal.
    this.queue.length = 0;
  }

  private emitBudgetExhausted(): void {
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
    budget: ReturnType<Budget["snapshot"]>;
  } {
    return {
      runId: this.graph.runId,
      eventCount: this.graph.events.length,
      queueDepth: this.queue.length,
      budget: this.budget.snapshot(),
    };
  }
}
