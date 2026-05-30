// Trace formatting + causal-chain audit.

import { describe, expect, it } from "vitest";

import {
  FrozenClock,
  Graph,
  IDGen,
  Trace,
  causalChain,
  makeEvent,
} from "../src/index.js";

function newGraph(): Graph {
  return new Graph({ ids: new IDGen(), clock: new FrozenClock() });
}

describe("Trace.lines", () => {
  it("renders standard event types with the tag column", () => {
    const g = newGraph();
    g.emit(
      makeEvent({
        id: g.ids.event(),
        type: "goal.created",
        payload: { goal: "x" },
        actor: "user",
        timestamp: g.clock.now(),
      }),
    );
    g.addObject("task", { title: "Research", status: "open" });
    const lines = new Trace(g).lines();
    expect(lines[0]).toMatch(/^\[goal\.created\]\s+user: "x"$/);
    expect(lines[1]).toMatch(/^\[object\.created\]\s+task#1 "Research" \(open\)$/);
  });

  it("renders relation.created with the arrow form", () => {
    const g = newGraph();
    const a = g.addObject("task", { title: "A" });
    const b = g.addObject("task", { title: "B" });
    g.addRelation(a.id, b.id, "depends_on");
    const lines = new Trace(g).lines();
    expect(lines.some((l) => /\[relation\.created\]\s+task#1 --depends_on--> task#2/.test(l))).toBe(
      true,
    );
  });

  it("renders patch.applied with per-field diff lines", () => {
    const g = newGraph();
    const o = g.addObject("task", { title: "X", status: "blocked" });
    g.patchObject(o.id, { status: "open" });
    const lines = new Trace(g).lines();
    expect(lines.some((l) => /\[patch\.applied\]\s+task#1 status: blocked -> open/.test(l))).toBe(
      true,
    );
  });
});

describe("causalChain", () => {
  it("walks back through caused_by links", () => {
    const g = newGraph();
    const goalEvent = g.emit(
      makeEvent({
        id: g.ids.event(),
        type: "goal.created",
        payload: { goal: "evaluate" },
        actor: "user",
        timestamp: g.clock.now(),
      }),
    );
    g.addObject("artifact", { title: "memo" }, { causedBy: goalEvent.id });

    const artifact = g.allObjects().find((o) => o.type === "artifact")!;
    const chain = causalChain(g, artifact.id);
    expect(chain).toContain(artifact.id);
    expect(chain).toContain("goal.created");
  });

  it("reports missing objects gracefully", () => {
    const g = newGraph();
    expect(causalChain(g, "nope#1")).toContain("no such object");
  });
});
