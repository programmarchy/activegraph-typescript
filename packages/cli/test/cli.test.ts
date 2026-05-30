// Basic CLI smoke tests. Each test captures console.log, invokes main()
// programmatically with an explicit argv, and asserts exit code +
// salient output. Doesn't shell out — that lives in an e2e gate.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { clearRegistry } from "@activegraph/runtime";

import { VERSION, main } from "../src/index.js";
import { openStore } from "../src/store-url.js";

function captureOut(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const spy = vi.spyOn(console, "log").mockImplementation((...args) => {
    lines.push(args.map((a) => String(a)).join(" "));
  });
  return { lines, restore: () => spy.mockRestore() };
}

const sqliteTmp = mkdtempSync(join(tmpdir(), "activegraph-cli-"));

afterAll(() => {
  rmSync(sqliteTmp, { recursive: true, force: true });
});

describe("CLI", () => {
  beforeEach(() => clearRegistry());

  it("version prints VERSION", async () => {
    const cap = captureOut();
    const code = await main(["version"]);
    cap.restore();
    expect(code).toBe(0);
    expect(cap.lines.join("\n")).toContain(VERSION);
  });

  it("status prints a runtime snapshot", async () => {
    const cap = captureOut();
    const code = await main(["status"]);
    cap.restore();
    expect(code).toBe(0);
    const json = JSON.parse(cap.lines.join("\n"));
    expect(json.eventCount).toBe(0);
    expect(json.queueDepth).toBe(0);
  });

  it("behaviors lists the registry", async () => {
    const cap = captureOut();
    const code = await main(["behaviors"]);
    cap.restore();
    expect(code).toBe(0);
    expect(cap.lines[0]).toBe("(no behaviors registered)");
  });

  it("quickstart runs end-to-end", async () => {
    const cap = captureOut();
    const code = await main(["quickstart"]);
    cap.restore();
    expect(code).toBe(0);
    const joined = cap.lines.join("\n");
    expect(joined).toContain("[goal.created]");
    expect(joined).toContain("[runtime.idle]");
  });

  it("inspect on an empty memory store prints 0 events", async () => {
    const cap = captureOut();
    const code = await main(["inspect", "memory:"]);
    cap.restore();
    expect(code).toBe(0);
    expect(cap.lines[0]).toContain("0 events");
  });

  it("migrate copies events between stores", async () => {
    // Pre-seed: write a couple events to a SQLite store, then migrate to
    // another file.
    const srcPath = join(sqliteTmp, "src.db");
    const dstPath = join(sqliteTmp, "dst.db");
    const src = openStore(`sqlite://${srcPath}`, { runId: "r1" });
    const { makeEvent } = await import("@activegraph/core");
    src.append(makeEvent({ id: "evt_001", type: "object.created", timestamp: "t" }));
    src.append(makeEvent({ id: "evt_002", type: "object.created", timestamp: "t" }));
    await src.close();

    const cap = captureOut();
    const code = await main([
      "migrate",
      "--from",
      `sqlite://${srcPath}`,
      "--to",
      `sqlite://${dstPath}`,
      "--run-id",
      "r1",
    ]);
    cap.restore();
    expect(code).toBe(0);

    const dst = openStore(`sqlite://${dstPath}`, { runId: "r1" });
    expect(await dst.count()).toBe(2);
    await dst.close();
  });
});
