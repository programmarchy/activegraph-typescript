// License test — LICENSE and NOTICE present at the repo root with the
// Apache-2.0 attribution Active Graph ships under.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
// from packages/core/test/license.test.ts → repo root
const REPO_ROOT = join(dirname(__filename), "..", "..", "..");

describe("LICENSE + NOTICE", () => {
  it("LICENSE exists and declares Apache 2.0", () => {
    const path = join(REPO_ROOT, "LICENSE");
    expect(existsSync(path)).toBe(true);
    const text = readFileSync(path, "utf8");
    expect(text).toContain("Apache License");
    expect(text).toContain("Version 2.0");
  });

  it("NOTICE exists and names the project", () => {
    const path = join(REPO_ROOT, "NOTICE");
    expect(existsSync(path)).toBe(true);
    const text = readFileSync(path, "utf8");
    expect(text).toContain("Active Graph");
  });
});
