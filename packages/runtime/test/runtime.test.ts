// Runtime loop, lifecycle events, failure handling, budget enforcement.

import { beforeEach, describe, expect, it } from "vitest";

import { FrozenClock, Graph, IDGen, makeEvent } from "@activegraph/core";

import {
  Runtime,
  clearRegistry,
  defineBehavior,
  defineRelationBehavior,
} from "../src/index.js";

function newGraph(): Graph {
  return new Graph({ ids: new IDGen(), clock: new FrozenClock() });
}

describe("Runtime lifecycle", () => {
  beforeEach(() => clearRegistry());

  it("emits behavior.started + behavior.completed + runtime.idle", async () => {
    defineBehavior({
      name: "noop",
      on: ["goal.created"],
      handler: () => {},
    });

    const g = newGraph();
    await new Runtime(g).runGoal("hello");

    const types = g.events.map((e) => e.type);
    expect(types).toContain("goal.created");
    expect(types).toContain("behavior.started");
    expect(types).toContain("behavior.completed");
    expect(types.at(-1)).toBe("runtime.idle");
  });

  it("behavior failures become behavior.failed events; loop continues", async () => {
    defineBehavior({
      name: "boom",
      on: ["goal.created"],
      handler: () => {
        throw new Error("kaboom");
      },
    });
    defineBehavior({
      name: "after",
      on: ["goal.created"],
      handler: (_e, graph) => {
        graph.addObject("marker", { ok: true });
      },
    });

    const g = newGraph();
    await new Runtime(g).runGoal("test");

    const types = g.events.map((e) => e.type);
    expect(types).toContain("behavior.failed");
    expect(g.allObjects().some((o) => o.type === "marker")).toBe(true);

    const failed = g.events.find((e) => e.type === "behavior.failed")!;
    expect(failed.payload.behavior).toBe("boom");
    expect(failed.payload.exception_type).toBe("Error");
    expect(failed.payload.message).toBe("kaboom");
    expect(String(failed.payload.stack)).toContain("kaboom");
  });

  it("budget exhaustion emits runtime.budget_exhausted with exhausted_by", async () => {
    defineBehavior({
      name: "loop",
      on: ["goal.created", "ping.tick"],
      handler: (_e, _g, ctx) => {
        ctx.emit("ping.tick", { n: 1 });
      },
    });

    const g = newGraph();
    await new Runtime(g, { budget: { maxEvents: 5 } }).runGoal("test");
    const last = g.events.at(-1)!;
    expect(last.type).toBe("runtime.budget_exhausted");
    expect(last.payload.exhausted_by).toBe("maxEvents");
  });

  it("relation behaviors fire per matching edge", async () => {
    const fired: Array<[string, string]> = [];
    defineRelationBehavior({
      name: "watch",
      relationType: "depends_on",
      on: ["task.completed"],
      handler: (rel) => {
        fired.push([rel.source, rel.target]);
      },
    });

    const g = newGraph();
    const a = g.addObject("task", {});
    const b = g.addObject("task", {});
    const c = g.addObject("task", {});
    g.addRelation(a.id, b.id, "depends_on");
    g.addRelation(a.id, c.id, "depends_on");

    const runtime = new Runtime(g);
    g.emit(
      makeEvent({
        id: g.ids.event(),
        type: "task.completed",
        payload: { task_id: a.id },
        actor: "user",
        timestamp: g.clock.now(),
      }),
    );
    await runtime.runUntilIdle();

    const sorted = fired.map((p) => p.join("->")).sort();
    expect(sorted).toEqual([`${a.id}->${b.id}`, `${a.id}->${c.id}`]);
  });

  it("explicit behaviors arg overrides the global registry", async () => {
    const fromRegistry = defineBehavior({
      name: "from_registry",
      on: ["goal.created"],
      handler: (_e, graph) => {
        graph.addObject("marker", { src: "registry" });
      },
    });
    const explicit = defineBehavior({
      name: "explicit",
      on: ["goal.created"],
      handler: (_e, graph) => {
        graph.addObject("marker", { src: "explicit" });
      },
    });
    expect(fromRegistry).not.toBe(explicit);

    const g = newGraph();
    await new Runtime(g, { behaviors: [explicit] }).runGoal("test");
    const sources = g.allObjects().map((o) => o.data.src);
    expect(sources).toEqual(["explicit"]);
  });
});

describe("Runtime status", () => {
  beforeEach(() => clearRegistry());

  it("reports run id, event count, queue depth, budget snapshot", async () => {
    const g = newGraph();
    const r = new Runtime(g, { budget: { maxEvents: 100 } });
    await r.runGoal("hi");
    const status = r.status();
    expect(status.runId).toBe(g.runId);
    expect(status.eventCount).toBeGreaterThan(0);
    expect(status.queueDepth).toBe(0);
    expect(status.budget.limits.maxEvents).toBe(100);
    expect(status.budget.used.maxEvents).toBeGreaterThan(0);
  });
});
