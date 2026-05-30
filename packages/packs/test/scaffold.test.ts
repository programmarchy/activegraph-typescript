// scaffoldPack writes a working starter pack tree.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { scaffoldPack } from "../src/index.js";

describe("scaffoldPack", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "activegraph-scaffold-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes a complete starter pack", async () => {
    const result = await scaffoldPack({
      name: "diligence-mini",
      dir,
      version: "0.1.0",
      description: "a small pack",
    });

    expect(result.packageDir).toBe(join(dir, "diligence-mini"));
    // Required artifacts present:
    for (const rel of [
      "package.json",
      "tsconfig.json",
      "src/index.ts",
      "src/prompts/welcome.md",
      "test/pack.test.ts",
      "README.md",
    ]) {
      expect(result.files.some((f) => f.endsWith(rel))).toBe(true);
    }
  });

  it("package.json has the expected shape", async () => {
    const result = await scaffoldPack({ name: "minipack", dir });
    const pkg = JSON.parse(readFileSync(join(result.packageDir, "package.json"), "utf8"));
    expect(pkg.name).toBe("@activegraph-pack/minipack");
    expect(pkg.version).toBe("0.1.0");
    expect(pkg.keywords).toContain("activegraph-pack");
    expect(pkg.dependencies).toHaveProperty("@activegraph/packs");
    expect(pkg.dependencies).toHaveProperty("zod");
  });

  it("src/index.ts uses camelCase variable from the pack name", async () => {
    const result = await scaffoldPack({ name: "my-research-pack", dir });
    const src = readFileSync(join(result.packageDir, "src/index.ts"), "utf8");
    expect(src).toContain("export const myResearchPackPack");
    expect(src).toContain('"my-research-pack"');
  });
});
