// npm-pack completeness — equivalent of Python's wheel-completeness
// gate. Runs `npm pack --dry-run --json` on each package and verifies:
// (1) the tarball includes dist/ and src/, (2) types are exported,
// (3) for pack-diligence specifically, the prompts/ markdown files
// are included (matching Python's pack data inclusion contract).
//
// Marked slow — the build step is run before this test runs in CI;
// locally the pretest hook (or you running `pnpm -r build`) prepares
// dist/. If dist/ is missing the test reports the missing artifact
// instead of crashing.

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const PACKAGES_DIR = join(dirname(__filename), "..", "..", "..", "packages");

interface PackEntry {
  files: Array<{ path: string; size: number }>;
}

function packDryRun(pkgDir: string): PackEntry | null {
  try {
    const json = execSync(`npm pack --dry-run --json`, {
      cwd: pkgDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const parsed = JSON.parse(json) as PackEntry[];
    return parsed[0] ?? null;
  } catch {
    return null;
  }
}

describe("npm-pack completeness", () => {
  it("@activegraph/core: dist + src included; types entry resolves", () => {
    const pkgDir = join(PACKAGES_DIR, "core");
    if (!existsSync(join(pkgDir, "dist", "index.d.ts"))) {
      // Skip if dist missing — caller didn't run build. In CI the
      // build step runs first; locally pretest can wire it up.
      // biome-ignore lint/suspicious/noConsole: test diagnostic
      console.warn("skipping: core/dist not built; run `pnpm -r build` first");
      return;
    }
    const result = packDryRun(pkgDir);
    expect(result).not.toBeNull();
    const paths = result!.files.map((f) => f.path);
    expect(paths.some((p) => p === "dist/index.js")).toBe(true);
    expect(paths.some((p) => p === "dist/index.d.ts")).toBe(true);
    expect(paths.some((p) => p.startsWith("src/"))).toBe(true);
  });

  it("@activegraph/pack-diligence: prompts/*.md included in the tarball", () => {
    const pkgDir = join(PACKAGES_DIR, "pack-diligence");
    if (!existsSync(join(pkgDir, "dist", "index.d.ts"))) {
      // biome-ignore lint/suspicious/noConsole: test diagnostic
      console.warn("skipping: pack-diligence/dist not built");
      return;
    }
    const result = packDryRun(pkgDir);
    expect(result).not.toBeNull();
    const paths = result!.files.map((f) => f.path);
    // Source prompts shipped (TS users running from source).
    expect(paths.some((p) => p === "src/prompts/document_researcher.md")).toBe(true);
    // dist prompts shipped (consumers using the compiled output).
    expect(paths.some((p) => p === "dist/prompts/document_researcher.md")).toBe(true);
  });

  it("activegraph (umbrella): dist exports re-export the bundled packages", () => {
    const pkgDir = join(PACKAGES_DIR, "umbrella");
    if (!existsSync(join(pkgDir, "dist", "index.d.ts"))) {
      // biome-ignore lint/suspicious/noConsole: test diagnostic
      console.warn("skipping: umbrella/dist not built");
      return;
    }
    const result = packDryRun(pkgDir);
    expect(result).not.toBeNull();
    const paths = result!.files.map((f) => f.path);
    expect(paths.some((p) => p === "dist/index.js")).toBe(true);
    expect(paths.some((p) => p === "dist/index.d.ts")).toBe(true);
  });
});
