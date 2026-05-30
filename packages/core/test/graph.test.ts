import { describe, expect, it } from "vitest";

import { FrozenClock, Graph, IDGen, applyEvent, makeEvent } from "../src/index.js";

function newGraph(): Graph {
  return new Graph({ ids: new IDGen(), clock: new FrozenClock() });
}

describe("Graph addObject", () => {
  it("creates an object with version 1 and provenance", () => {
    const g = newGraph();
    const o = g.addObject("task", { title: "Research" });
    expect(o.id).toBe("task#1");
    expect(o.version).toBe(1);
    expect(o.data.title).toBe("Research");
    expect(o.provenance.created_by).toBe("system");
    expect(o.provenance.run_id).toBe(g.runId);
  });

  it("strips provenance keys from caller data", () => {
    const g = newGraph();
    const o = g.addObject("task", { title: "X", provenance: { created_by: "hacker" } });
    expect(o.data.provenance).toBeUndefined();
    expect(o.provenance.created_by).toBe("system");
  });

  it("emits an object.created event", () => {
    const g = newGraph();
    g.addObject("task", { title: "Research" });
    const e = g.events.at(-1)!;
    expect(e.type).toBe("object.created");
    expect((e.payload.object as { id: string }).id).toBe("task#1");
  });
});

describe("Graph relations", () => {
  it("creates and queries relations", () => {
    const g = newGraph();
    const a = g.addObject("task", { title: "A" });
    const b = g.addObject("task", { title: "B" });
    g.addRelation(a.id, b.id, "depends_on");

    expect(g.relations({ type: "depends_on" })).toHaveLength(1);
    expect(g.relations({ source: a.id })).toHaveLength(1);
    expect(g.relations({ target: b.id })).toHaveLength(1);
    expect(g.relations({ source: b.id })).toHaveLength(0);
  });

  it("removing an object cascades its relations", () => {
    const g = newGraph();
    const a = g.addObject("task", { title: "A" });
    const b = g.addObject("task", { title: "B" });
    g.addRelation(a.id, b.id, "depends_on");

    g.removeObject(a.id);
    expect(g.getObject(a.id)).toBeUndefined();
    expect(g.allRelations()).toHaveLength(0);
  });

  it("getRelations respects direction filter", () => {
    const g = newGraph();
    const a = g.addObject("task", { title: "A" });
    const b = g.addObject("task", { title: "B" });
    g.addRelation(a.id, b.id, "depends_on");

    expect(g.getRelations({ objectId: a.id, direction: "outgoing" })).toHaveLength(1);
    expect(g.getRelations({ objectId: a.id, direction: "incoming" })).toHaveLength(0);
    expect(g.getRelations({ objectId: b.id, direction: "incoming" })).toHaveLength(1);
    expect(g.getRelations({ objectId: b.id, direction: "both" })).toHaveLength(1);
  });
});

describe("Graph projector (applyEvent)", () => {
  it("reapplies an event log to reconstruct state", () => {
    const original = newGraph();
    const a = original.addObject("task", { title: "A" });
    const b = original.addObject("task", { title: "B" });
    original.addRelation(a.id, b.id, "depends_on");
    original.patchObject(a.id, { title: "A-updated" });

    const reconstructed = newGraph();
    for (const event of original.events) {
      reconstructed.replayEvent(event);
    }

    expect(reconstructed.allObjects()).toHaveLength(2);
    expect(reconstructed.allRelations()).toHaveLength(1);
    expect(reconstructed.getObject(a.id)?.data.title).toBe("A-updated");
    expect(reconstructed.getObject(a.id)?.version).toBe(2);
    expect(reconstructed.replayedIds.size).toBe(original.events.length);
  });

  it("emit is the only mutator (raw emit applies projection)", () => {
    const g = newGraph();
    const event = makeEvent({
      id: g.ids.event(),
      type: "object.created",
      payload: {
        object: {
          id: "raw#99",
          type: "raw",
          data: { x: 1 },
          version: 1,
          provenance: { run_id: g.runId },
        },
      },
      timestamp: g.clock.now(),
    });
    g.emit(event);
    expect(g.getObject("raw#99")?.data.x).toBe(1);

    // applyEvent is also callable directly for projection-only consumers.
    const other = newGraph();
    applyEvent(other, event);
    expect(other.getObject("raw#99")?.data.x).toBe(1);
  });
});

describe("Graph where clause", () => {
  it("filters objects by where", () => {
    const g = newGraph();
    g.addObject("task", { title: "A", status: "open" });
    g.addObject("task", { title: "B", status: "blocked" });
    g.addObject("task", { title: "C", status: "open" });

    const open = g.objects({ type: "task", where: { "data.status": "open" } });
    expect(open).toHaveLength(2);
    expect(open.map((o) => o.data.title).sort()).toEqual(["A", "C"]);
  });

  it("supports comparison operators", () => {
    const g = newGraph();
    g.addObject("claim", { confidence: 0.3 });
    g.addObject("claim", { confidence: 0.8 });
    g.addObject("claim", { confidence: 0.95 });

    const high = g.objects({ type: "claim", where: { "data.confidence": { ">=": 0.8 } } });
    expect(high).toHaveLength(2);
  });
});

describe("Graph store attachment", () => {
  it("refuses re-attach with a different store", () => {
    const g = newGraph();
    const sinkA = { append: () => {} };
    const sinkB = { append: () => {} };
    g.attachStore(sinkA);
    expect(() => g.attachStore(sinkB)).toThrow(/already has a store/);
    // Same instance is idempotent.
    expect(() => g.attachStore(sinkA)).not.toThrow();
  });
});
