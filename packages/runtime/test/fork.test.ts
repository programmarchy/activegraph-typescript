// Runtime.fork + structural diff between parent and fork.
//
// Forks branch a run at any event into an independent fork over a fresh
// Graph. structuralDiff renders the divergence after both runs have
// progressed.

import { beforeEach, describe, expect, it } from "vitest";

import { FrozenClock, Graph, IDGen } from "@activegraph/core";

import {
  Runtime,
  clearRegistry,
  defineBehavior,
  structuralDiff,
} from "../src/index.js";

function newGraph(): Graph {
  return new Graph({ ids: new IDGen(), clock: new FrozenClock() });
}

describe("Runtime.fork", () => {
  beforeEach(() => clearRegistry());

  it("copies the prefix up to atEventId and gives the fork a fresh run id", async () => {
    defineBehavior({
      name: "seed",
      on: ["goal.created"],
      handler: (_e, graph) => {
        graph.addObject("task", { title: "A", status: "open" });
        graph.addObject("task", { title: "B", status: "open" });
      },
    });

    const parent = newGraph();
    const r = new Runtime(parent);
    await r.runGoal("plan");

    // Pick the fork point — fork after the first task is created.
    const cutEvent = parent.events.find(
      (e) =>
        e.type === "object.created" &&
        ((e.payload.object as Record<string, unknown>).data as Record<string, unknown>).title ===
          "A",
    )!;
    const fork = r.fork(cutEvent.id, { label: "fork-after-A" });

    expect(fork.graph.runId).not.toBe(parent.runId);
    expect(fork.graph.parentRunId).toBe(parent.runId);
    expect(fork.graph.forkedAtEventId).toBe(cutEvent.id);
    expect(fork.graph.label).toBe("fork-after-A");

    // Prefix replayed (no listener fires, no new events emitted).
    const titles = fork.graph.allObjects().map((o) => o.data.title);
    expect(titles).toEqual(["A"]);
    expect(fork.graph.events).toHaveLength(parent.events.indexOf(cutEvent) + 1);
  });

  it("the fork can diverge independently of the parent", async () => {
    defineBehavior({
      name: "seed",
      on: ["goal.created"],
      handler: (_e, graph) => {
        graph.addObject("task", { title: "T", status: "open" });
      },
    });

    const parent = newGraph();
    const r = new Runtime(parent);
    await r.runGoal("plan");

    const t = parent.allObjects().find((o) => o.type === "task")!;
    // Fork after task creation; mutate independently on each side.
    const created = parent.events.find(
      (e) =>
        e.type === "object.created" &&
        (e.payload.object as Record<string, unknown>).id === t.id,
    )!;
    const fork = r.fork(created.id);

    parent.patchObject(t.id, { status: "blocked" });
    fork.graph.patchObject(t.id, { status: "done" });

    expect(parent.getObject(t.id)?.data.status).toBe("blocked");
    expect(fork.graph.getObject(t.id)?.data.status).toBe("done");
  });

  it("rejects an unknown atEventId", () => {
    const parent = newGraph();
    const r = new Runtime(parent);
    expect(() => r.fork("evt_999")).toThrow(/no event with that id/);
  });
});

describe("structuralDiff(parent, fork)", () => {
  beforeEach(() => clearRegistry());

  it("reports divergent fields and only-in-A/B objects", async () => {
    defineBehavior({
      name: "seed",
      on: ["goal.created"],
      handler: (_e, graph) => {
        graph.addObject("task", { title: "T", status: "open" });
      },
    });

    const parent = newGraph();
    const r = new Runtime(parent);
    await r.runGoal("plan");

    const t = parent.allObjects().find((o) => o.type === "task")!;
    const created = parent.events.find(
      (e) =>
        e.type === "object.created" &&
        (e.payload.object as Record<string, unknown>).id === t.id,
    )!;
    const fork = r.fork(created.id);

    parent.patchObject(t.id, { status: "blocked" });
    fork.graph.patchObject(t.id, { status: "done" });
    fork.graph.addObject("note", { text: "fork-only" });

    const diff = structuralDiff(parent, fork.graph);
    expect(diff.objects.divergent).toHaveLength(1);
    expect(diff.objects.divergent[0]!.changedFields).toContain("status");
    expect(diff.objects.onlyInB.map((o) => o.type)).toContain("note");
    expect(diff.objects.onlyInA).toHaveLength(0);
  });
});
