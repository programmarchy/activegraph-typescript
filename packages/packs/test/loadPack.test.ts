// Pack object/relation type validation wired into Graph.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Graph } from "@activegraph/core";

import {
  PackConflictError,
  PackSchemaViolation,
  PackVersionConflictError,
  clearDiscoveryCache,
  definePack,
  discover,
  loadByName,
  loadPack,
  loadPromptsFromDir,
  registerPack,
} from "../src/index.js";

// A minimal Zod-shaped schema (avoid taking a runtime dep on zod for
// the tests).
function objSchema<T extends Record<string, unknown>>(required: (keyof T)[]) {
  return {
    parse(input: unknown): T {
      if (input === null || typeof input !== "object" || Array.isArray(input)) {
        throw new Error("expected object");
      }
      const obj = input as Record<string, unknown>;
      for (const key of required) {
        if (!(String(key) in obj)) throw new Error(`missing required field: ${String(key)}`);
      }
      return obj as T;
    },
  };
}

describe("definePack", () => {
  it("hashes prompts when no hash is given", () => {
    const pack = definePack({
      name: "x",
      version: "1.0",
      prompts: [{ name: "p", text: "hello" }],
    });
    expect(pack.prompts[0]!.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("respects explicit prompt hash", () => {
    const pack = definePack({
      name: "x",
      version: "1.0",
      prompts: [{ name: "p", text: "hello", hash: "deadbeef" }],
    });
    expect(pack.prompts[0]!.hash).toBe("deadbeef");
  });
});

describe("loadPack", () => {
  it("enforces object-type schema on Graph.addObject", () => {
    const Claim = objSchema<{ text: string; confidence: number }>(["text", "confidence"]);
    const pack = definePack({
      name: "diligence-mini",
      version: "0.1.0",
      objectTypes: [{ name: "claim", schema: Claim }],
    });

    const g = new Graph();
    loadPack(g, pack);

    expect(() => g.addObject("claim", { text: "x", confidence: 0.9 })).not.toThrow();
    expect(() => g.addObject("claim", { text: "x" })).toThrow(PackSchemaViolation);
    // Unknown types pass through untyped.
    expect(() => g.addObject("note", { x: 1 })).not.toThrow();
  });

  it("enforces allowedSources / allowedTargets on Graph.addRelation", () => {
    const Stub = { parse: (v: unknown) => v as Record<string, unknown> };
    const pack = definePack({
      name: "shapes",
      version: "0.1.0",
      objectTypes: [
        { name: "claim", schema: Stub },
        { name: "evidence", schema: Stub },
      ],
      relationTypes: [
        { name: "supports", allowedSources: ["evidence"], allowedTargets: ["claim"] },
      ],
    });

    const g = new Graph();
    loadPack(g, pack);

    const c = g.addObject("claim", {});
    const e = g.addObject("evidence", {});
    expect(() => g.addRelation(e.id, c.id, "supports")).not.toThrow();
    expect(() => g.addRelation(c.id, e.id, "supports")).toThrow(PackSchemaViolation);
  });

  it("composes with previously-loaded pack validators (no override)", () => {
    const Claim = objSchema<{ text: string }>(["text"]);
    const Evidence = objSchema<{ source: string }>(["source"]);
    const packA = definePack({
      name: "a",
      version: "1",
      objectTypes: [{ name: "claim", schema: Claim }],
    });
    const packB = definePack({
      name: "b",
      version: "1",
      objectTypes: [{ name: "evidence", schema: Evidence }],
    });

    const g = new Graph();
    loadPack(g, packA);
    loadPack(g, packB);

    expect(() => g.addObject("claim", { text: "x" })).not.toThrow();
    expect(() => g.addObject("evidence", { source: "s" })).not.toThrow();
    expect(() => g.addObject("claim", {})).toThrow(PackSchemaViolation);
  });

  it("rejects duplicate object-type names within one pack", () => {
    const Stub = { parse: (v: unknown) => v as Record<string, unknown> };
    expect(() =>
      loadPack(
        new Graph(),
        definePack({
          name: "dup",
          version: "1",
          objectTypes: [
            { name: "claim", schema: Stub },
            { name: "claim", schema: Stub },
          ],
        }),
      ),
    ).toThrow(PackConflictError);
  });
});

describe("registerPack / loadByName / discover", () => {
  beforeEach(() => clearDiscoveryCache());

  it("registerPack then loadByName returns the pack", () => {
    const p = definePack({ name: "x", version: "1.0" });
    registerPack(p);
    expect(loadByName("x")).toBe(p);
  });

  it("loadByName throws when not registered", () => {
    expect(() => loadByName("missing")).toThrow(/no pack registered/);
  });

  it("registerPack rejects a version conflict on the same name", () => {
    registerPack(definePack({ name: "x", version: "1.0" }));
    expect(() => registerPack(definePack({ name: "x", version: "2.0" }))).toThrow(
      PackVersionConflictError,
    );
  });

  it("discover lists all registered packs", () => {
    registerPack(definePack({ name: "a", version: "1" }));
    registerPack(definePack({ name: "b", version: "1" }));
    const names = discover().map((d) => d.name).sort();
    expect(names).toEqual(["a", "b"]);
  });
});

describe("loadPromptsFromDir", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "activegraph-prompts-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads .md files, names by basename, hashes contents", async () => {
    writeFileSync(join(dir, "summarize.md"), "Summarize the input.");
    writeFileSync(join(dir, "extract.md"), "Extract claims from the text.");
    writeFileSync(join(dir, "ignored.txt"), "non-markdown");

    const prompts = await loadPromptsFromDir(dir);
    const byName = Object.fromEntries(prompts.map((p) => [p.name, p]));
    expect(Object.keys(byName).sort()).toEqual(["extract", "summarize"]);
    expect(byName.summarize!.text).toBe("Summarize the input.");
    expect(byName.summarize!.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("throws PackPromptLoadError when dir does not exist", async () => {
    await expect(loadPromptsFromDir("/nope/does/not/exist")).rejects.toThrow(
      /cannot read prompts directory/,
    );
  });
});
