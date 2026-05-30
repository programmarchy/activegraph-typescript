// Wire-format contract — the on-disk JSON shape of an Event is part of
// the cross-runtime peers contract (D4 in PORT-PLAN.md). This test
// pins the JSON keys and shape that both runtimes must produce so a
// fixture recorded by one can be replayed by the other.

import { describe, expect, it } from "vitest";

import { eventToJSON, makeEvent } from "../src/index.js";

describe("Event wire format (cross-runtime contract)", () => {
  it("uses snake_case keys to match Python's serde", () => {
    const e = makeEvent({
      id: "evt_001",
      type: "goal.created",
      payload: { goal: "test" },
      actor: "user",
      frameId: "frame_001",
      causedBy: "evt_000",
      timestamp: "2026-05-15T10:32:01Z",
    });
    const j = eventToJSON(e);

    // Locked key names — Python's Event.to_dict produces the same.
    expect(Object.keys(j).sort()).toEqual([
      "actor",
      "caused_by",
      "frame_id",
      "id",
      "payload",
      "timestamp",
      "type",
    ]);

    expect(j).toEqual({
      id: "evt_001",
      type: "goal.created",
      payload: { goal: "test" },
      actor: "user",
      frame_id: "frame_001",
      caused_by: "evt_000",
      timestamp: "2026-05-15T10:32:01Z",
    });
  });

  it("round-trips a JSON event produced by another runtime", () => {
    // Construct an event in the wire format (as if read from a fixture
    // recorded by the Python runtime).
    const fromWire = {
      id: "evt_042",
      type: "object.created",
      payload: {
        object: {
          id: "claim#7",
          type: "claim",
          data: { text: "Market is growing", confidence: 0.85 },
          version: 1,
          provenance: { created_by: "researcher", run_id: "RUN_XYZ" },
        },
        id: "claim#7",
      },
      actor: "researcher",
      frame_id: null,
      caused_by: "evt_041",
      timestamp: "2026-05-15T10:32:05Z",
    };

    // The TS-side reader needs to translate the snake_case keys to the
    // TS camelCase shape; makeEvent accepts both forms via its EventInit
    // input, but typed call sites convert explicitly. Here we model the
    // common case: hand-translate at the boundary.
    const e = makeEvent({
      id: fromWire.id,
      type: fromWire.type,
      payload: fromWire.payload,
      actor: fromWire.actor,
      frameId: fromWire.frame_id,
      causedBy: fromWire.caused_by,
      timestamp: fromWire.timestamp,
    });

    expect(e.id).toBe("evt_042");
    expect(e.frameId).toBeNull();
    expect(e.causedBy).toBe("evt_041");
    expect((e.payload.object as { type: string }).type).toBe("claim");

    // Round-tripping back to JSON produces an equal shape.
    const back = eventToJSON(e);
    expect(back).toEqual(fromWire);
  });

  it("payload preserves null and empty values exactly (no JSON stringify drift)", () => {
    const e = makeEvent({
      id: "evt_x",
      type: "x",
      payload: {
        empty_string: "",
        zero: 0,
        false_val: false,
        null_val: null,
        empty_array: [],
        empty_object: {},
      },
      timestamp: "t",
    });
    const j = eventToJSON(e);
    expect(JSON.parse(JSON.stringify(j)).payload).toEqual({
      empty_string: "",
      zero: 0,
      false_val: false,
      null_val: null,
      empty_array: [],
      empty_object: {},
    });
  });
});
