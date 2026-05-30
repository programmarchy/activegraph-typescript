// Store URL parser — sqlite:///path, sqlite::memory:, memory:.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { InMemoryEventStore } from "@activegraph/store-memory";
import { SQLiteEventStore } from "@activegraph/store-sqlite";

import { openStore } from "../src/store-url.js";

const dir = mkdtempSync(join(tmpdir(), "activegraph-store-url-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("openStore", () => {
  it("memory: returns InMemoryEventStore", () => {
    const s = openStore("memory:");
    expect(s).toBeInstanceOf(InMemoryEventStore);
  });

  it("sqlite::memory: opens an in-memory SQLite", () => {
    const s = openStore("sqlite::memory:");
    expect(s).toBeInstanceOf(SQLiteEventStore);
    s.close();
  });

  it("sqlite:///path opens a file SQLite", () => {
    const path = join(dir, "x.db");
    const s = openStore(`sqlite://${path}`);
    expect(s).toBeInstanceOf(SQLiteEventStore);
    s.close();
  });

  it("respects an explicit runId", () => {
    const s = openStore("memory:", { runId: "explicit_run" });
    expect(s.runId).toBe("explicit_run");
  });

  it("postgres:// throws a 'not supported at CLI' error", () => {
    expect(() => openStore("postgres://user@host/db")).toThrow(/not yet supported/);
  });

  it("unknown scheme throws", () => {
    expect(() => openStore("foo://bar")).toThrow(/unknown store URL scheme/);
  });
});
