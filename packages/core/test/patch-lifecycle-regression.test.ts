// v1.0.1 patch lifecycle regression — applyPatch on an already-applied
// patch throws ExecutionError, applyPatch on a rejected patch throws,
// rejecting a non-existent patch throws, applyPatch surfaces
// version-mismatch as a patch.rejected event (not an exception).

import { describe, expect, it } from "vitest";

import { ExecutionError, FrozenClock, Graph, IDGen } from "../src/index.js";

function newGraph(): Graph {
  return new Graph({ ids: new IDGen(), clock: new FrozenClock() });
}

describe("Patch lifecycle (v1.0.1 regression)", () => {
  it("applyPatch on an already-applied patch throws ExecutionError", () => {
    const g = newGraph();
    const o = g.addObject("task", { status: "open" });
    const p = g.proposePatch(o.id, "update", { status: "done" }, { proposedBy: "A" });
    g.applyPatch(p.id);
    expect(() => g.applyPatch(p.id)).toThrow(ExecutionError);
  });

  it("applyPatch on a rejected patch throws ExecutionError", () => {
    const g = newGraph();
    const o = g.addObject("task", { status: "open" });
    const p = g.proposePatch(o.id, "update", { status: "done" }, { proposedBy: "A" });
    g.rejectPatch(p.id, "human said no");
    expect(() => g.applyPatch(p.id)).toThrow(ExecutionError);
  });

  it("applyPatch on unknown id throws", () => {
    const g = newGraph();
    expect(() => g.applyPatch("patch_999")).toThrow(/unknown patch/);
  });

  it("version mismatch surfaces as patch.rejected, not a thrown exception", () => {
    const g = newGraph();
    const o = g.addObject("task", { status: "open" });
    const p = g.proposePatch(o.id, "update", { status: "done" }, { proposedBy: "A" });
    g.patchObject(o.id, { status: "blocked" }); // bumps version

    // Should NOT throw — the rejection is an event, not an exception.
    expect(() => g.applyPatch(p.id)).not.toThrow();
    const last = g.events.at(-1)!;
    expect(last.type).toBe("patch.rejected");
    expect(g.getPatch(p.id)?.status).toBe("rejected");
  });

  it("rejectPatch on unknown id throws", () => {
    const g = newGraph();
    expect(() => g.rejectPatch("patch_999", "x")).toThrow(/unknown patch/);
  });
});
