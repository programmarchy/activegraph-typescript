// Replay trace snapshot — events tagged [replay.event] with the
// boundary lines [replay.complete] + [runtime.idle] before any live
// continuation.

import { beforeEach, describe, expect, it } from "vitest";

import { FrozenClock, Graph, IDGen, Trace } from "@activegraph/core";
import { InMemoryEventStore } from "@activegraph/store-memory";

import {
  Runtime,
  clearRegistry,
  defineBehavior,
} from "../src/index.js";

describe("Replay trace snapshot", () => {
  beforeEach(() => clearRegistry());

  it("renders replay.event prefix and the boundary markers", async () => {
    defineBehavior({
      name: "noop",
      on: ["goal.created"],
      handler: (_e, graph) => {
        graph.addObject("task", { title: "x" });
      },
    });

    // Record:
    const g1 = new Graph({ ids: new IDGen(), clock: new FrozenClock() });
    const store = new InMemoryEventStore(g1.runId);
    g1.attachStore(store);
    await new Runtime(g1).runGoal("record");

    // Replay (permissive — no behaviors re-fire):
    const replayed = await Runtime.load(store);
    // Append one live event so the boundary lines are visible.
    await replayed.runGoal("continue");

    const text = `${new Trace(replayed.graph).lines().join("\n")}\n`;
    await expect(text).toMatchFileSnapshot("./snapshots/replay-trace.txt");
  });
});
