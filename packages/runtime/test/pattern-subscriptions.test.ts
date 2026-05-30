// Pattern subscriptions in runtime dispatch.

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

describe("Pattern subscriptions", () => {
  beforeEach(() => clearRegistry());

  it("fires only when the pattern matches the current graph shape", async () => {
    const fired: string[] = [];
    defineBehavior({
      name: "critic",
      on: ["object.created"],
      pattern: "(c:claim)-[:contradicts]->(d:claim)",
      handler: (_e, _g, ctx) => {
        for (const m of ctx.matches) fired.push(`${m.bindings.c}->${m.bindings.d}`);
      },
    });

    const g = newGraph();
    const r = new Runtime(g);
    await r.runGoal("test");
    // No contradiction yet — the behavior shouldn't have fired despite
    // any object.created events.
    expect(fired).toEqual([]);

    const a = g.addObject("claim", {});
    const b = g.addObject("claim", {});
    g.addRelation(a.id, b.id, "contradicts");
    await r.runUntilIdle();

    expect(fired).toContain(`${a.id}->${b.id}`);
  });

  it("emits pattern.matched with bindings", async () => {
    defineBehavior({
      name: "spot",
      on: ["object.created"],
      pattern: "(c:claim)",
      handler: () => {},
    });

    const g = newGraph();
    const r = new Runtime(g);
    g.addObject("claim", { text: "X" });
    await r.runUntilIdle();

    const patternMatched = g.events.filter((e) => e.type === "pattern.matched");
    expect(patternMatched.length).toBeGreaterThan(0);
    const last = patternMatched.at(-1)!;
    expect(last.payload.behavior).toBe("spot");
    expect(Number(last.payload.matches_count)).toBeGreaterThan(0);
  });

  it("pattern-only behavior (no on=) fires on every event the matcher hits", async () => {
    const fired: number[] = [];
    defineBehavior({
      name: "audit",
      pattern: "(c:claim)",
      handler: (_e, _g, ctx) => {
        fired.push(ctx.matches.length);
      },
    });

    const g = newGraph();
    const r = new Runtime(g);
    g.addObject("claim", {});
    g.addObject("claim", {});
    await r.runUntilIdle();

    expect(fired.length).toBeGreaterThan(0);
    expect(fired.at(-1)).toBe(2);
  });

  it("relation behaviors can use patterns", async () => {
    const fired: string[] = [];
    defineRelationBehavior({
      name: "watch-contradictions",
      relationType: "contradicts",
      on: ["relation.created"],
      pattern: "(c:claim)-[:contradicts]->(d:claim)",
      handler: (rel) => {
        fired.push(`${rel.source}->${rel.target}`);
      },
    });

    const g = newGraph();
    const r = new Runtime(g);
    const a = g.addObject("claim", {});
    const b = g.addObject("claim", {});
    g.addRelation(a.id, b.id, "contradicts");
    await r.runUntilIdle();

    expect(fired).toContain(`${a.id}->${b.id}`);
  });
});
