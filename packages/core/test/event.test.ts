import { describe, expect, it } from "vitest";

import { eventToJSON, makeEvent } from "../src/index.js";

describe("makeEvent", () => {
  it("defaults optional fields", () => {
    const e = makeEvent({ id: "evt_001", type: "x" });
    expect(e.payload).toEqual({});
    expect(e.actor).toBeNull();
    expect(e.frameId).toBeNull();
    expect(e.causedBy).toBeNull();
    expect(e.timestamp).toBe("");
  });

  it("populates fields when provided", () => {
    const e = makeEvent({
      id: "evt_001",
      type: "goal.created",
      payload: { goal: "x" },
      actor: "user",
      frameId: "frame_001",
      causedBy: null,
      timestamp: "2026-05-15T10:32:01Z",
    });
    expect(e.id).toBe("evt_001");
    expect(e.type).toBe("goal.created");
    expect(e.payload).toEqual({ goal: "x" });
    expect(e.actor).toBe("user");
    expect(e.frameId).toBe("frame_001");
    expect(e.causedBy).toBeNull();
    expect(e.timestamp).toBe("2026-05-15T10:32:01Z");
  });

  it("serializes to JSON with snake_case keys (wire format)", () => {
    const e = makeEvent({
      id: "evt_001",
      type: "x",
      frameId: "frame_001",
      causedBy: "evt_000",
    });
    const j = eventToJSON(e);
    expect(j).toMatchObject({
      id: "evt_001",
      type: "x",
      frame_id: "frame_001",
      caused_by: "evt_000",
    });
  });
});
