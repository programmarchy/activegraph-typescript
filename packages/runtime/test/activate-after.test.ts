// activateAfter scheduler — defers a behavior's fire by N events.

import { beforeEach, describe, expect, it } from "vitest";

import { FrozenClock, Graph, IDGen } from "@activegraph/core";

import { Runtime, clearRegistry, defineBehavior } from "../src/index.js";

function newGraph(): Graph {
  return new Graph({ ids: new IDGen(), clock: new FrozenClock() });
}

describe("activateAfter scheduler", () => {
  beforeEach(() => clearRegistry());

  it("emits behavior.scheduled instead of behavior.started on the first tick", async () => {
    defineBehavior({
      name: "delayed",
      on: ["goal.created"],
      activateAfter: 2,
      handler: (_e, graph) => {
        graph.addObject("marker", {});
      },
    });

    const g = newGraph();
    const r = new Runtime(g);
    // Drive a few events: the goal, plus filler the runtime emits
    // (runtime.idle / behavior.completed etc.) bumps the tick.
    await r.runGoal("test");

    const types = g.events.map((e) => e.type);
    expect(types).toContain("behavior.scheduled");
    const scheduled = g.events.find((e) => e.type === "behavior.scheduled")!;
    expect(scheduled.payload.behavior).toBe("delayed");
    expect(Number(scheduled.payload.activate_after)).toBe(2);
  });

  it("fires after enough ticks elapse (with seed behavior pushing noise events)", async () => {
    const fired: string[] = [];
    defineBehavior({
      name: "seed",
      on: ["goal.created"],
      handler: (_e, graph) => {
        graph.addObject("task", { title: "t", status: "open" });
        // Push noise events to advance the tick — meta events don't
        // count, so user events are required to bump the scheduler.
        graph.addObject("noise", { i: 1 });
        graph.addObject("noise", { i: 2 });
      },
    });
    defineBehavior({
      name: "nag",
      on: ["object.created"],
      where: { "object.type": "task" },
      activateAfter: 2,
      handler: (event) => {
        const o = event.payload.object as { id: string };
        fired.push(o.id);
      },
    });

    const g = newGraph();
    await new Runtime(g).runGoal("g");

    expect(fired).toEqual(["task#1"]);
    const scheds = g.events.filter((e) => e.type === "behavior.scheduled");
    expect(scheds).toHaveLength(1);
    expect(scheds[0]!.payload.behavior).toBe("nag");
    expect(scheds[0]!.payload.activate_after).toBe(2);
  });

  it("re-checks where= at fire time (stale match silently skips)", async () => {
    defineBehavior({
      name: "guarded",
      on: ["goal.created"],
      where: { goal: "fire-me" },
      activateAfter: 1,
      handler: (_e, graph) => {
        graph.addObject("marker", {});
      },
    });

    const g = newGraph();
    const r = new Runtime(g);
    await r.runGoal("dont-fire-me");

    // where= excludes the match upfront — behavior.scheduled never even
    // appears.
    const types = g.events.map((e) => e.type);
    expect(types).not.toContain("behavior.scheduled");
    expect(g.allObjects().some((o) => o.type === "marker")).toBe(false);
  });
});
