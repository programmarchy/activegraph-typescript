// runtime.status() snapshot — runId, eventCount, queueDepth,
// delayedCount, tick, budget.

import { beforeEach, describe, expect, it } from "vitest";

import { FrozenClock, Graph, IDGen } from "@activegraph/core";

import {
  Runtime,
  clearRegistry,
  defineBehavior,
} from "../src/index.js";

function newGraph(): Graph {
  return new Graph({ ids: new IDGen(), clock: new FrozenClock() });
}

describe("Runtime.status()", () => {
  beforeEach(() => clearRegistry());

  it("zero state on a fresh runtime", () => {
    const g = newGraph();
    const r = new Runtime(g);
    const s = r.status();
    expect(s.runId).toBe(g.runId);
    expect(s.eventCount).toBe(0);
    expect(s.queueDepth).toBe(0);
    expect(s.delayedCount).toBe(0);
    expect(s.tick).toBe(0);
  });

  it("reports tick + eventCount after a runGoal", async () => {
    defineBehavior({
      name: "noop",
      on: ["goal.created"],
      handler: () => {},
    });
    const g = newGraph();
    const r = new Runtime(g);
    await r.runGoal("test");
    const s = r.status();
    expect(s.eventCount).toBeGreaterThan(0);
    expect(s.tick).toBeGreaterThan(0);
    expect(s.queueDepth).toBe(0);
    expect(s.delayedCount).toBe(0);
  });

  it("reports a delayedCount while a scheduled entry is pending", async () => {
    defineBehavior({
      name: "seed",
      on: ["goal.created"],
      handler: (_e, graph) => {
        graph.addObject("task", { title: "t" });
      },
    });
    defineBehavior({
      name: "later",
      on: ["object.created"],
      where: { "object.type": "task" },
      activateAfter: 99, // big number — won't fire in this run
      handler: () => {},
    });
    const g = newGraph();
    const r = new Runtime(g);
    await r.runGoal("test");
    const s = r.status();
    expect(s.delayedCount).toBe(1);
  });

  it("budget snapshot shape", () => {
    const g = newGraph();
    const r = new Runtime(g, { budget: { maxEvents: 100, maxCostUsd: 1 } });
    const b = r.status().budget;
    expect(b.limits.maxEvents).toBe(100);
    expect(b.costLimitUsd).toBe(1);
    expect(b.used.maxEvents).toBe(0);
  });
});
