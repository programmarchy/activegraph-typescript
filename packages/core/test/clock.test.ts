import { describe, expect, it } from "vitest";

import { FrozenClock, TickingClock } from "../src/index.js";

describe("FrozenClock", () => {
  it("returns the same value on every call", () => {
    const c = new FrozenClock("2026-05-15T10:32:01Z");
    expect(c.now()).toBe("2026-05-15T10:32:01Z");
    expect(c.now()).toBe("2026-05-15T10:32:01Z");
  });
});

describe("TickingClock", () => {
  it("advances by stepSeconds on every call", () => {
    const c = new TickingClock("2026-05-15T10:32:01Z", 1);
    const a = c.now();
    const b = c.now();
    const d = c.now();
    expect(a).toBe("2026-05-15T10:32:01Z");
    expect(b).toBe("2026-05-15T10:32:02Z");
    expect(d).toBe("2026-05-15T10:32:03Z");
  });
});
