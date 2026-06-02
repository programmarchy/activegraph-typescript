// Persistence — emit through Runtime, restore via Runtime.load,
// continue with another run. Tested against InMemory + SQLite.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { FrozenClock, Graph, IDGen } from "@activegraph/core";
import { InMemoryEventStore } from "@activegraph/store-memory";
import { SQLiteEventStore } from "@activegraph/store-sqlite";

import { Runtime, clearRegistry, defineBehavior } from "../src/index.js";

function newGraph(): Graph {
  return new Graph({ ids: new IDGen(), clock: new FrozenClock() });
}

const dir = mkdtempSync(join(tmpdir(), "activegraph-persistence-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("Persistence", () => {
  beforeEach(() => clearRegistry());

  it("InMemoryEventStore: emit, restore, continue", async () => {
    defineBehavior({
      name: "echo",
      on: ["goal.created"],
      handler: (_e, graph) => {
        graph.addObject("note", { text: "first" });
      },
    });

    const original = newGraph();
    const store = new InMemoryEventStore(original.runId);
    original.attachStore(store);
    await new Runtime(original).runGoal("first");
    const firstCount = store.count();

    const r2 = await Runtime.load(store);
    await r2.runGoal("second");
    expect(store.count()).toBeGreaterThan(firstCount);
    expect(r2.graph.allObjects().filter((o) => o.type === "note")).toHaveLength(2);
  });

  it("SQLiteEventStore: emit, restore from a new SQLiteEventStore over the same path", async () => {
    defineBehavior({
      name: "echo",
      on: ["goal.created"],
      handler: (_e, graph) => {
        graph.addObject("note", { text: "x" });
      },
    });

    const path = join(dir, "round-trip.db");
    const g1 = newGraph();
    const s1 = new SQLiteEventStore({ path, runId: g1.runId });
    g1.attachStore(s1);
    await new Runtime(g1).runGoal("first");
    const recordedCount = s1.count();
    s1.close();

    // Re-open from disk.
    const s2 = new SQLiteEventStore({ path, runId: g1.runId });
    expect(s2.count()).toBe(recordedCount);

    const events: ReturnType<typeof g1.events.at>[] = [];
    for (const ev of s2.iterEvents()) events.push(ev);
    expect(events.length).toBe(recordedCount);
    s2.close();
  });

  it("payload round-trip preserves nested + unicode + null", async () => {
    const g = newGraph();
    const store = new InMemoryEventStore(g.runId);
    g.attachStore(store);

    g.addObject("custom", {
      nested: { items: [1, 2, { a: "b" }] },
      unicode: "café — 🚀",
      empty: [] as unknown[],
      "null-valued": null,
    });

    const reloaded = await Runtime.load(store);
    const obj = reloaded.graph.allObjects().find((o) => o.type === "custom");
    expect(obj?.data).toEqual({
      nested: { items: [1, 2, { a: "b" }] },
      unicode: "café — 🚀",
      empty: [],
      "null-valued": null,
    });
  });

  it("awaits async store appends before runGoal resolves", async () => {
    const g = newGraph();
    const appended: string[] = [];
    g.attachStore({
      async append(event) {
        await new Promise((resolve) => setTimeout(resolve, 1));
        appended.push(event.id);
      },
    });

    await new Runtime(g).runGoal("durable");

    expect(appended).toEqual(g.events.map((event) => event.id));
  });

  it("surfaces async store append failures from runGoal", async () => {
    const g = newGraph();
    g.attachStore({
      async append() {
        await new Promise((resolve) => setTimeout(resolve, 1));
        throw new Error("store write failed");
      },
    });

    await expect(new Runtime(g).runGoal("durable")).rejects.toThrow(/store write failed/);
  });
});
