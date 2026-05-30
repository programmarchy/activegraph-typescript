// Runtime.load — replay an event log into a fresh runtime that can
// continue from where the recording left off. Strict mode re-fires
// behaviors and detects divergence.

import { beforeEach, describe, expect, it } from "vitest";

import { FrozenClock, Graph, IDGen } from "@activegraph/core";
import { InMemoryEventStore } from "@activegraph/store-memory";

import {
  ReplayDivergenceError,
  Runtime,
  clearRegistry,
  defineBehavior,
} from "../src/index.js";

function newGraph(): Graph {
  return new Graph({ ids: new IDGen(), clock: new FrozenClock() });
}

describe("Runtime.load (permissive)", () => {
  beforeEach(() => clearRegistry());

  it("replays recorded events into a fresh Graph without firing behaviors", async () => {
    let fireCount = 0;
    defineBehavior({
      name: "counter",
      on: ["goal.created"],
      handler: (_e, graph) => {
        fireCount += 1;
        graph.addObject("marker", { n: fireCount });
      },
    });

    // Record a run.
    const original = newGraph();
    const store = new InMemoryEventStore(original.runId);
    original.attachStore(store);
    await new Runtime(original).runGoal("record");
    expect(fireCount).toBe(1);

    // Permissive replay: state restored, behaviors NOT re-fired.
    fireCount = 0;
    const replayed = await Runtime.load(store);
    expect(replayed.graph.allObjects().some((o) => o.type === "marker")).toBe(true);
    expect(fireCount).toBe(0); // didn't re-fire
    expect(replayed.graph.events.length).toBe(original.events.length);
    expect(replayed.graph.replayedIds.size).toBe(original.events.length);
  });

  it("continued runs append to the same store", async () => {
    defineBehavior({
      name: "echo",
      on: ["goal.created"],
      handler: (_e, graph) => {
        graph.addObject("note", {});
      },
    });

    const original = newGraph();
    const store = new InMemoryEventStore(original.runId);
    original.attachStore(store);
    await new Runtime(original).runGoal("first");
    const firstCount = store.count();

    const replayed = await Runtime.load(store);
    await replayed.runGoal("second");
    expect(store.count()).toBeGreaterThan(firstCount);
  });
});

describe("Runtime.load (strict)", () => {
  beforeEach(() => clearRegistry());

  it("passes when behaviors produce the same event stream", async () => {
    defineBehavior({
      name: "deterministic",
      on: ["goal.created"],
      handler: (_e, graph) => {
        graph.addObject("task", { title: "T" });
      },
    });

    const original = newGraph();
    const store = new InMemoryEventStore(original.runId);
    original.attachStore(store);
    await new Runtime(original).runGoal("test");

    await expect(Runtime.load(store, { strict: true })).resolves.toBeDefined();
  });

  it("throws ReplayDivergenceError when re-run produces a different event stream", async () => {
    let phase: "record" | "replay" = "record";

    defineBehavior({
      name: "moody",
      on: ["goal.created"],
      handler: (_e, graph) => {
        if (phase === "record") {
          graph.addObject("recorded-only", {});
        } else {
          graph.addObject("replay-only", { differs: true });
          graph.addObject("extra", {});
        }
      },
    });

    const original = newGraph();
    const store = new InMemoryEventStore(original.runId);
    original.attachStore(store);
    await new Runtime(original).runGoal("test");

    phase = "replay";
    await expect(Runtime.load(store, { strict: true })).rejects.toBeInstanceOf(
      ReplayDivergenceError,
    );
  });
});
