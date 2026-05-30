// Scaffold a new pack — `activegraph scaffold <name>` writes a starter
// package layout to disk.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface ScaffoldOptions {
  /** Pack name (also becomes the package name as @activegraph-pack/<name>). */
  name: string;
  /** Output directory. The scaffold writes a `<name>/` subtree there. */
  dir: string;
  /** Initial version. Defaults to 0.1.0. */
  version?: string;
  /** Description for the pack. */
  description?: string;
}

export interface ScaffoldResult {
  packageDir: string;
  files: string[];
}

/**
 * Write a starter pack: package.json, src/index.ts with a `definePack`
 * stub + a Zod-shaped object type, prompts/ dir with one prompt,
 * README, a basic vitest test.
 *
 * Returns the absolute paths of the files written so the CLI can show
 * them to the user.
 */
export async function scaffoldPack(opts: ScaffoldOptions): Promise<ScaffoldResult> {
  const version = opts.version ?? "0.1.0";
  const description = opts.description ?? `${opts.name} pack for Active Graph`;
  const packageDir = join(opts.dir, opts.name);
  const srcDir = join(packageDir, "src");
  const promptsDir = join(srcDir, "prompts");
  const testDir = join(packageDir, "test");

  await mkdir(promptsDir, { recursive: true });
  await mkdir(testDir, { recursive: true });

  const files: string[] = [];

  async function write(rel: string, body: string): Promise<void> {
    const full = join(packageDir, rel);
    await writeFile(full, body);
    files.push(full);
  }

  await write(
    "package.json",
    JSON.stringify(
      {
        name: `@activegraph-pack/${opts.name}`,
        version,
        description,
        type: "module",
        main: "./dist/index.js",
        module: "./dist/index.js",
        types: "./dist/index.d.ts",
        exports: {
          ".": {
            types: "./dist/index.d.ts",
            import: "./dist/index.js",
          },
        },
        files: ["dist", "src", "README.md"],
        keywords: ["activegraph-pack"],
        scripts: {
          build: "tsc -b",
          test: "vitest run",
        },
        dependencies: {
          "@activegraph/packs": "^1.0.5",
          zod: "^4.0.0",
        },
        devDependencies: {
          typescript: "^5.6.0",
          vitest: "^2.0.0",
        },
      },
      null,
      2,
    ) + "\n",
  );

  await write(
    "tsconfig.json",
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "Bundler",
          strict: true,
          declaration: true,
          outDir: "dist",
          rootDir: "src",
          esModuleInterop: true,
          skipLibCheck: true,
          verbatimModuleSyntax: true,
        },
        include: ["src/**/*.ts"],
      },
      null,
      2,
    ) + "\n",
  );

  await write(
    "src/index.ts",
    `// @activegraph-pack/${opts.name}

import { type Pack, definePack } from "@activegraph/packs";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const __filename = fileURLToPath(import.meta.url);
const PROMPTS_DIR = join(dirname(__filename), "prompts");

function loadPromptSync(name: string): { name: string; text: string } {
  return { name, text: readFileSync(join(PROMPTS_DIR, name + ".md"), "utf8") };
}

export const ExampleSchema = z.object({
  title: z.string(),
  status: z.enum(["open", "done"]).default("open"),
});

export const ${camelCase(opts.name)}Pack: Pack = definePack({
  name: "${opts.name}",
  version: "${version}",
  description: ${JSON.stringify(description)},
  objectTypes: [{ name: "example", schema: ExampleSchema }],
  prompts: [loadPromptSync("welcome")],
});
`,
  );

  await write(
    "src/prompts/welcome.md",
    `# Welcome prompt

You are a behavior in the ${opts.name} pack.
Describe your task here.
`,
  );

  await write(
    "test/pack.test.ts",
    `import { describe, expect, it } from "vitest";

import { ${camelCase(opts.name)}Pack, ExampleSchema } from "../src/index.js";

describe("${opts.name} pack", () => {
  it("registers an example object type", () => {
    expect(${camelCase(opts.name)}Pack.objectTypes.map((t) => t.name)).toContain("example");
  });

  it("Example schema applies defaults", () => {
    expect(ExampleSchema.parse({ title: "x" })).toEqual({ title: "x", status: "open" });
  });
});
`,
  );

  await write(
    "README.md",
    `# @activegraph-pack/${opts.name}

${description}

## Usage

\`\`\`ts
import { Graph } from "@activegraph/core";
import { loadPack } from "@activegraph/packs";
import { ${camelCase(opts.name)}Pack } from "@activegraph-pack/${opts.name}";

const graph = new Graph();
loadPack(graph, ${camelCase(opts.name)}Pack);
\`\`\`
`,
  );

  return { packageDir, files };
}

function camelCase(name: string): string {
  return name
    .split(/[-_]/)
    .map((p, i) => (i === 0 ? p : p[0]!.toUpperCase() + p.slice(1)))
    .join("");
}
