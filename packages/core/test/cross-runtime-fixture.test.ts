// Cross-runtime fixture interop — load a JSON event log shaped exactly
// as the Python runtime serializes (Event.to_dict), replay it into a
// fresh TS Graph, and verify the projected state. Pins the wire
// contract (D4 in PORT-PLAN.md): a fixture recorded by one runtime
// must replay in the other.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { type Event, Graph, IDGen, eventToJSON, makeEvent } from "../src/index.js";

const __filename = fileURLToPath(import.meta.url);
const FIXTURE_PATH = join(dirname(__filename), "fixtures", "python-recorded-run.json");

interface WireEvent {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  actor: string | null;
  frame_id: string | null;
  caused_by: string | null;
  timestamp: string;
}

interface WireFixture {
  run_id: string;
  events: WireEvent[];
}

function wireToEvent(w: WireEvent): Event {
  return makeEvent({
    id: w.id,
    type: w.type,
    payload: w.payload,
    actor: w.actor,
    frameId: w.frame_id,
    causedBy: w.caused_by,
    timestamp: w.timestamp,
  });
}

describe("Cross-runtime fixture interop", () => {
  it("replays a Python-shaped fixture into a TS Graph", () => {
    const fixture: WireFixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));
    const events = fixture.events.map(wireToEvent);

    const graph = new Graph({ ids: new IDGen(), runId: fixture.run_id });
    for (const ev of events) graph.replayEvent(ev);

    // 2 objects: claim#1, evidence#2.
    expect(graph.allObjects().map((o) => o.id).sort()).toEqual(["claim#1", "evidence#2"]);

    // claim#1 was patch.applied → status:"reviewed", version 2.
    const claim = graph.getObject("claim#1")!;
    expect(claim.data.status).toBe("reviewed");
    expect(claim.version).toBe(2);

    // The supports relation projected from rel_001.
    expect(graph.allRelations()).toHaveLength(1);
    const rel = graph.allRelations()[0]!;
    expect(rel.type).toBe("supports");
    expect(rel.source).toBe("evidence#2");
    expect(rel.target).toBe("claim#1");

    // Run id flows through.
    expect(graph.runId).toBe("RUN_PY_FIXTURE_001");

    // Every replayed event is tracked in replayedIds.
    expect(graph.replayedIds.size).toBe(events.length);
  });

  it("wire-format round-trip is identity (read → wire → re-read)", () => {
    const fixture: WireFixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));
    const events = fixture.events.map(wireToEvent);

    // Round-trip through eventToJSON (which uses snake_case keys).
    const roundTripped = events.map(eventToJSON);

    for (let i = 0; i < events.length; i++) {
      expect(roundTripped[i]).toEqual({
        id: fixture.events[i]!.id,
        type: fixture.events[i]!.type,
        payload: fixture.events[i]!.payload,
        actor: fixture.events[i]!.actor,
        frame_id: fixture.events[i]!.frame_id,
        caused_by: fixture.events[i]!.caused_by,
        timestamp: fixture.events[i]!.timestamp,
      });
    }
  });
});
