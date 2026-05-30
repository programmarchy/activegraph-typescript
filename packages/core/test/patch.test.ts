// Patch lifecycle. Versioning (CONTRACT #4) and single-target atomic
// (CONTRACT #12).

import { describe, expect, it } from "vitest";

import { FrozenClock, Graph, IDGen } from "../src/index.js";

function newGraph(): Graph {
  return new Graph({ ids: new IDGen(), clock: new FrozenClock() });
}

describe("Patch lifecycle", () => {
  it("patchObject emits patch.applied with diff", () => {
    const g = newGraph();
    const o = g.addObject("task", { status: "blocked" });
    const p = g.patchObject(o.id, { status: "open" });

    expect(p.status).toBe("applied");
    expect(g.getObject(o.id)?.version).toBe(2);
    expect(g.getObject(o.id)?.data.status).toBe("open");

    const last = g.events[g.events.length - 1]!;
    expect(last.type).toBe("patch.applied");
    expect(last.payload.target).toBe(o.id);
    const diff = last.payload.diff as Record<string, { old: unknown; new: unknown }>;
    expect(diff.status).toEqual({ old: "blocked", new: "open" });
  });

  it("proposePatch emits proposed and can apply", () => {
    const g = newGraph();
    const o = g.addObject("memory", { summary: "old" });
    const p = g.proposePatch(o.id, "update", { summary: "new" }, {
      proposedBy: "memory_behavior",
      rationale: "user said so",
    });
    expect(p.status).toBe("proposed");

    const types = g.events.map((e) => e.type);
    expect(types).toContain("patch.proposed");

    g.applyPatch(p.id, { approvedBy: "reviewer" });
    expect(g.getObject(o.id)?.data.summary).toBe("new");
    expect(g.getObject(o.id)?.version).toBe(2);
    expect(g.getPatch(p.id)?.status).toBe("applied");
  });

  it("applyPatch with stale version is rejected", () => {
    const g = newGraph();
    const o = g.addObject("memory", { summary: "v1" });
    const p = g.proposePatch(o.id, "update", { summary: "v3-from-stale-branch" }, {
      proposedBy: "A",
    });

    g.patchObject(o.id, { summary: "v2" });
    expect(g.getObject(o.id)?.version).toBe(2);

    g.applyPatch(p.id, { approvedBy: "reviewer" });
    const lastType = g.events[g.events.length - 1]!.type;
    expect(lastType).toBe("patch.rejected");
    expect(g.getObject(o.id)?.data.summary).toBe("v2");
    expect(g.getPatch(p.id)?.status).toBe("rejected");
  });
});
