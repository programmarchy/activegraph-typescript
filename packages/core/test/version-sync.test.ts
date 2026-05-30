// Version-sync — every @activegraph/* package, the umbrella, the CLI
// VERSION constant, and the internalBugFields hardcoded framework
// version all agree.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { internalBugFields } from "../src/index.js";

const __filename = fileURLToPath(import.meta.url);
const PACKAGES_DIR = join(dirname(__filename), "..", "..", "..", "packages");

describe("Version sync", () => {
  const versions = new Map<string, string>();
  for (const name of readdirSync(PACKAGES_DIR)) {
    const pkgPath = join(PACKAGES_DIR, name, "package.json");
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      versions.set(pkg.name as string, pkg.version as string);
    } catch {
      // skip non-package dirs
    }
  }

  it("at least 14 packages registered", () => {
    expect(versions.size).toBeGreaterThanOrEqual(14);
  });

  it("every @activegraph/* + activegraph share one version", () => {
    const unique = new Set(versions.values());
    expect(
      unique.size,
      `version drift detected:\n${[...versions.entries()].map(([k, v]) => `  ${k}: ${v}`).join("\n")}`,
    ).toBe(1);
  });

  it("internalBugFields embeds the same version (used in framework-bug error context)", () => {
    const expected = [...versions.values()][0]!;
    const fields = internalBugFields({
      summary: "x",
      whatHappened: "x",
      whyInvariant: "x",
      location: "x",
    });
    expect(fields.context.framework_version).toBe(expected);
  });
});
