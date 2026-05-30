// Runtime.load re-queues events whose behaviors never fired in the
// recording (e.g. budget exhausted mid-dispatch). The next
// runUntilIdle picks up where the recorded run left off.

import { beforeEach, describe, expect, it } from "vitest";

import { FrozenClock, Graph, IDGen } from "@activegraph/core";
import { InMemoryEventStore } from "@activegraph/store-memory";

import {
  Runtime,
  clearRegistry,
  defineBehavior,
} from "../src/index.js";

function newGraph(): Graph {
  return new Graph({ ids: new IDGen(), clock: new FrozenClock() });
}

describe("requeue-unfired on Runtime.load", () => {
  beforeEach(() => clearRegistry());

  it("re-queues an event that had no behavior.started referencing it", async () => {
    // Build a recorded log manually so we can simulate a budget-
    // exhausted recording: a custom event with no caused-by-behavior
    // ever started.
    const g = newGraph();
    const store = new InMemoryEventStore(g.runId);
    g.attachStore(store);
    // Emit a user event directly — no behavior fired on it.
    g.emit({
      id: g.ids.event(),
      type: "alert",
      payload: { msg: "wake up" },
      actor: "user",
      frameId: null,
      causedBy: null,
      timestamp: "t",
    });

    let observed = false;
    defineBehavior({
      name: "alerter",
      on: ["alert"],
      handler: () => {
        observed = true;
      },
    });

    const runtime = await Runtime.load(store);
    await runtime.runUntilIdle();
    expect(observed).toBe(true);
  });

  it("does NOT re-queue events that already had a behavior fired on them", async () => {
    let calls = 0;
    defineBehavior({
      name: "counter",
      on: ["goal.created"],
      handler: () => {
        calls += 1;
      },
    });

    const g = newGraph();
    const store = new InMemoryEventStore(g.runId);
    g.attachStore(store);
    await new Runtime(g).runGoal("first");
    expect(calls).toBe(1);

    // Reload. The goal.created has a behavior.started → it should NOT
    // be re-queued.
    const runtime = await Runtime.load(store);
    await runtime.runUntilIdle();
    expect(calls).toBe(1);
  });

  it("does NOT re-queue meta or graph-mutation events", async () => {
    let fired = false;
    defineBehavior({
      name: "anything",
      on: ["object.created"],
      handler: () => {
        fired = true;
      },
    });

    const g = newGraph();
    const store = new InMemoryEventStore(g.runId);
    g.attachStore(store);
    // Emit an object.created directly (graph-mutation event).
    g.addObject("foo", {});

    fired = false;
    const runtime = await Runtime.load(store);
    await runtime.runUntilIdle();
    // object.created events are not re-queued — they're graph
    // mutations, not stimuli.
    expect(fired).toBe(false);
  });
});
