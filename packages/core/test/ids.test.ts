import { describe, expect, it } from "vitest";

import { IDGen } from "../src/index.js";

describe("IDGen", () => {
  it("object ids are global monotonic with type prefix", () => {
    const ids = new IDGen();
    expect(ids.object("task")).toBe("task#1");
    expect(ids.object("task")).toBe("task#2");
    expect(ids.object("claim")).toBe("claim#3");
  });

  it("event ids are zero-padded", () => {
    const ids = new IDGen();
    expect(ids.event()).toBe("evt_001");
    expect(ids.event()).toBe("evt_002");
  });

  it("relation/patch/frame namespaces", () => {
    const ids = new IDGen();
    expect(ids.relation()).toBe("rel_001");
    expect(ids.patch()).toBe("patch_001");
    expect(ids.frame()).toBe("frame_001");
  });

  it("run ids are 26-char ULIDs", () => {
    const ids = new IDGen();
    const r = ids.run();
    expect(r).toHaveLength(26);
    expect(/^[0-9A-HJKMNP-TV-Z]{26}$/.test(r)).toBe(true);
  });
});
