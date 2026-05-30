// v1.0.3 behavior.failed UX — exception_type, message, stack all
// populated; the loop continues; subsequent behaviors still fire.

import { beforeEach, describe, expect, it } from "vitest";

import { FrozenClock, Graph, IDGen } from "@activegraph/core";

import { Runtime, clearRegistry, defineBehavior } from "../src/index.js";

function newGraph(): Graph {
  return new Graph({ ids: new IDGen(), clock: new FrozenClock() });
}

describe("behavior.failed UX (v1.0.3 contract)", () => {
  beforeEach(() => clearRegistry());

  it("payload carries behavior, exception_type, message, stack", async () => {
    defineBehavior({
      name: "boom",
      on: ["goal.created"],
      handler: () => {
        throw new TypeError("specific cause");
      },
    });
    const g = newGraph();
    await new Runtime(g).runGoal("test");
    const failed = g.events.find((e) => e.type === "behavior.failed")!;
    expect(failed.payload.behavior).toBe("boom");
    expect(failed.payload.exception_type).toBe("TypeError");
    expect(failed.payload.message).toBe("specific cause");
    expect(typeof failed.payload.stack).toBe("string");
    expect(String(failed.payload.stack)).toContain("specific cause");
  });

  it("dispatch loop continues past a failed behavior", async () => {
    let aRan = false;
    let cRan = false;
    defineBehavior({
      name: "a",
      on: ["goal.created"],
      handler: () => {
        aRan = true;
      },
    });
    defineBehavior({
      name: "b-fails",
      on: ["goal.created"],
      handler: () => {
        throw new Error("kaboom");
      },
    });
    defineBehavior({
      name: "c",
      on: ["goal.created"],
      handler: () => {
        cRan = true;
      },
    });

    const g = newGraph();
    await new Runtime(g).runGoal("test");
    expect(aRan).toBe(true);
    expect(cRan).toBe(true);
    expect(g.events.filter((e) => e.type === "behavior.failed")).toHaveLength(1);
  });

  it("non-Error thrown values still produce behavior.failed", async () => {
    defineBehavior({
      name: "throws-string",
      on: ["goal.created"],
      handler: () => {
        // eslint-disable-next-line no-throw-literal
        throw "raw string";
      },
    });
    const g = newGraph();
    await new Runtime(g).runGoal("test");
    const failed = g.events.find((e) => e.type === "behavior.failed")!;
    expect(failed).toBeDefined();
    expect(String(failed.payload.message)).toBe("raw string");
  });
});
