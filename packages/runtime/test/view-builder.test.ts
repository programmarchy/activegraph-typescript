// View builder rules — scope, around+depth, recent events, types filter.

import { beforeEach, describe, expect, it } from "vitest";

import { FrozenClock, Graph, IDGen } from "@activegraph/core";

import { Runtime, clearRegistry, defineBehavior } from "../src/index.js";

function newGraph(): Graph {
  return new Graph({ ids: new IDGen(), clock: new FrozenClock() });
}

describe("View builder", () => {
  beforeEach(() => clearRegistry());

  it("default view is the full graph", async () => {
    const seen: { objs: number; events: number } = { objs: 0, events: 0 };

    defineBehavior({
      name: "capture",
      on: ["goal.created"],
      handler: (_e, _g, ctx) => {
        seen.objs = ctx.view.objects().length;
        seen.events = ctx.view.events().length;
      },
    });

    const g = newGraph();
    g.addObject("task", { title: "pre-existing" });
    await new Runtime(g).runGoal("test");
    expect(seen.objs).toBeGreaterThan(0);
    expect(seen.events).toBeGreaterThan(0);
  });

  it("around + depth + types filter narrows the view", async () => {
    const captured: { types: string[] } = { types: [] };

    defineBehavior({
      name: "critic",
      on: ["object.created"],
      where: { "object.type": "claim" },
      viewSpec: {
        around: "payload.object.id",
        depth: 1,
        types: ["claim", "evidence"],
      },
      handler: (_e, _g, ctx) => {
        captured.types = ctx.view.objects().map((o) => o.type);
      },
    });

    const g = newGraph();
    const r = new Runtime(g);
    g.addObject("task", { title: "noise" }); // unrelated
    g.addObject("claim", { text: "x", confidence: 0.9 });
    await r.runUntilIdle();

    expect(captured.types).not.toContain("task"); // filtered by types
    expect(captured.types).toContain("claim");
  });

  it("view.objects({ type }) filters at read time", async () => {
    const counts: { claims: number; tasks: number } = { claims: 0, tasks: 0 };

    defineBehavior({
      name: "counter",
      on: ["goal.created"],
      handler: (_e, _g, ctx) => {
        counts.claims = ctx.view.objects({ type: "claim" }).length;
        counts.tasks = ctx.view.objects({ type: "task" }).length;
      },
    });

    const g = newGraph();
    g.addObject("claim", { text: "a" });
    g.addObject("claim", { text: "b" });
    g.addObject("task", { title: "t" });
    await new Runtime(g).runGoal("test");

    expect(counts.claims).toBe(2);
    expect(counts.tasks).toBe(1);
  });
});
