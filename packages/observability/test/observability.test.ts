import { describe, expect, it } from "vitest";

import { makeEvent } from "@activegraph/core";
import { InMemoryEventStore } from "@activegraph/store-memory";

import {
  NoOpMetrics,
  PrometheusMetrics,
  configureLogging,
  getLogger,
  migrate,
} from "../src/index.js";

describe("NoOpMetrics", () => {
  it("does not throw on increment/observe", () => {
    const m = new NoOpMetrics();
    expect(() => m.increment("x")).not.toThrow();
    expect(() => m.observe("y", 1)).not.toThrow();
  });
});

describe("PrometheusMetrics", () => {
  it("emits a counter line in the registry serialization", async () => {
    const m = new PrometheusMetrics();
    m.increment("test_counter_total", 2, { kind: "alpha" });
    m.increment("test_counter_total", 1, { kind: "alpha" });
    m.observe("test_latency_seconds", 0.42, { stage: "fetch" });

    const out = await m.serialize();
    expect(out).toContain("test_counter_total");
    expect(out).toMatch(/test_counter_total\{kind="alpha"\} 3/);
    expect(out).toContain("test_latency_seconds");
  });
});

describe("configureLogging", () => {
  it("returns a Logger and updates the global", () => {
    const logger = configureLogging({ level: "warn" });
    expect(typeof logger.info).toBe("function");
    expect(getLogger()).toBe(logger);
  });
});

describe("migrate", () => {
  it("copies all events from from-store to to-store in order", async () => {
    const src = new InMemoryEventStore("src");
    const dst = new InMemoryEventStore("dst");
    for (let i = 0; i < 5; i++) {
      src.append(
        makeEvent({ id: `evt_${i}`, type: "object.created", timestamp: "t" }),
      );
    }

    const report = await migrate({ from: src, to: dst });
    expect(report.ok).toBe(true);
    expect(report.runs[0]!.eventsCopied).toBe(5);
    expect(dst.count()).toBe(5);
    const ids: string[] = [];
    for (const ev of dst.iterEvents()) ids.push(ev.id);
    expect(ids).toEqual(["evt_0", "evt_1", "evt_2", "evt_3", "evt_4"]);
  });

  it("returns ok:false on duplicate-id append failure", async () => {
    const src = new InMemoryEventStore("src");
    const dst = new InMemoryEventStore("dst");
    src.append(makeEvent({ id: "evt_dup", type: "x", timestamp: "t" }));
    dst.append(makeEvent({ id: "evt_dup", type: "x", timestamp: "t" }));
    const report = await migrate({ from: src, to: dst });
    expect(report.ok).toBe(false);
    expect(report.runs[0]!.error).toBeDefined();
  });
});
