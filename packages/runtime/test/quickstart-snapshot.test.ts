// Quickstart trace snapshot — pins the exact text the canonical example
// produces. Catches subtle format drift in the trace printer.

import { beforeEach, describe, expect, it } from "vitest";

import { FrozenClock, Graph, IDGen, Trace } from "@activegraph/core";

import {
  Runtime,
  clearRegistry,
  defineBehavior,
  defineRelationBehavior,
} from "../src/index.js";

describe("Quickstart trace snapshot", () => {
  beforeEach(() => clearRegistry());

  it("matches the locked text", async () => {
    defineBehavior({
      name: "planner",
      on: ["goal.created"],
      handler: (_e, graph) => {
        const r = graph.addObject("task", { title: "Research", status: "open" });
        const m = graph.addObject("task", { title: "Draft memo", status: "blocked" });
        graph.addRelation(r.id, m.id, "depends_on");
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

    const graph = new Graph({ ids: new IDGen(), clock: new FrozenClock() });
    await new Runtime(graph, { budget: { maxEvents: 200 } }).runGoal(
      "Evaluate this startup idea",
    );
    const text = `${new Trace(graph).lines().join("\n")}\n`;
    await expect(text).toMatchFileSnapshot("./snapshots/quickstart-trace.txt");
  });
});
