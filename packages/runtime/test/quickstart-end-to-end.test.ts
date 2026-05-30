// Quickstart end-to-end — mirrors the canonical example: a planner
// creates tasks, a researcher does work, a relation behavior unblocks
// dependents.

import { beforeEach, describe, expect, it } from "vitest";

import { FrozenClock, Graph, IDGen } from "@activegraph/core";

import {
  Runtime,
  clearRegistry,
  defineBehavior,
  defineRelationBehavior,
} from "../src/index.js";

function newGraph(): Graph {
  return new Graph({ ids: new IDGen(), clock: new FrozenClock() });
}

describe("Quickstart end-to-end", () => {
  beforeEach(() => clearRegistry());

  it("planner + researcher + relation behavior — full canonical flow", async () => {
    defineBehavior({
      name: "planner",
      on: ["goal.created"],
      handler: (_e, graph) => {
        const research = graph.addObject("task", { title: "Research", status: "open" });
        const memo = graph.addObject("task", { title: "Draft memo", status: "blocked" });
        graph.addRelation(research.id, memo.id, "depends_on");
      },
    });

    defineBehavior({
      name: "researcher",
      on: ["object.created"],
      where: { "object.type": "task" },
      handler: (event, graph, ctx) => {
        const task = event.payload.object as Record<string, unknown>;
        const data = task.data as Record<string, unknown>;
        if (data.status !== "open" || typeof data.title !== "string") return;
        if (!data.title.includes("Research")) return;
        graph.addObject("claim", { text: "Market early but growing.", confidence: 0.7 });
        ctx.emit("task.completed", { task_id: task.id });
      },
    });

    defineRelationBehavior({
      name: "unblock",
      relationType: "depends_on",
      on: ["task.completed"],
      handler: (relation, event, graph) => {
        if (event.payload.task_id === relation.source) {
          graph.patchObject(relation.target, { status: "open" });
        }
      },
    });

    const graph = newGraph();
    const runtime = new Runtime(graph, { budget: { maxEvents: 200 } });
    await runtime.runGoal("Evaluate this startup idea");

    const tasks = graph.allObjects().filter((o) => o.type === "task");
    expect(tasks).toHaveLength(2);
    const memo = tasks.find((t) => t.data.title === "Draft memo")!;
    // Unblocked by the relation behavior.
    expect(memo.data.status).toBe("open");

    const claims = graph.allObjects().filter((o) => o.type === "claim");
    expect(claims).toHaveLength(1);
    expect(claims[0]!.data.text).toContain("Market");

    // Trace contains the expected lifecycle markers.
    const types = graph.events.map((e) => e.type);
    expect(types).toContain("goal.created");
    expect(types).toContain("relation_behavior.started");
    expect(types).toContain("patch.applied");
    expect(types.at(-1)).toBe("runtime.idle");
  });
});
