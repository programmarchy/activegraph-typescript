// @activegraph/cli — the `activegraph` command.
//
// Subcommands today:
//   quickstart                          Run the built-in quickstart demo
//   version                             Print version
//   status                              Print a runtime status snapshot
//   behaviors                           List behaviors in the global registry
//   inspect <store-url> [--run-id]      List events in a store
//   migrate --from <url> --to <url>     Copy events between stores
//   replay <store-url> [--strict]       Permissive or strict replay
//   fork <store-url> --at-event <evt>   Fork a stored run

import { Command } from "commander";

import { Graph, Trace, type makeEvent } from "@activegraph/core";
import { migrate } from "@activegraph/observability";
import {
  Runtime,
  clearRegistry,
  defineBehavior,
  getRegistry,
  structuralDiff,
} from "@activegraph/runtime";
import { InMemoryEventStore } from "@activegraph/store-memory";

import { openStore } from "./store-url.js";

export const VERSION = "1.0.5-alpha.0";

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const program = new Command();
  program
    .name("activegraph")
    .description("Event-sourced reactive graph runtime")
    .version(VERSION, "-V, --version");

  let exitCode = 0;
  const set = (code: number): void => {
    exitCode = code;
  };

  program
    .command("quickstart")
    .description("Run the built-in quickstart demo")
    .action(async () => set(await quickstart()));

  program
    .command("version")
    .description("Print version (alias for --version)")
    .action(() => out(VERSION));

  program
    .command("status")
    .description("Print a runtime status snapshot for a fresh empty runtime")
    .action(() => out(JSON.stringify(new Runtime(new Graph()).status(), null, 2)));

  program
    .command("behaviors")
    .description("List behaviors in the global registry")
    .action(() => set(behaviorsCmd()));

  program
    .command("inspect <storeUrl>")
    .description("List events in a store (most recent N)")
    .option("--run-id <id>", "Run id")
    .option("-n, --count <n>", "Number of events to show", "20")
    .action(async (storeUrl: string, opts: { runId?: string; count?: string }) =>
      set(await inspectCmd(storeUrl, opts)),
    );

  program
    .command("migrate")
    .description("Copy events from one store to another")
    .requiredOption("--from <url>", "Source store URL")
    .requiredOption("--to <url>", "Destination store URL")
    .option("--run-id <id>", "Run id (must match in both)")
    .action(async (opts: { from: string; to: string; runId?: string }) =>
      set(await migrateCmd(opts)),
    );

  program
    .command("replay <storeUrl>")
    .description("Replay a run from a store")
    .option("--strict", "Strict replay: re-fire behaviors and verify divergence")
    .option("--run-id <id>", "Run id")
    .action(async (storeUrl: string, opts: { strict?: boolean; runId?: string }) =>
      set(await replayCmd(storeUrl, opts)),
    );

  program
    .command("fork <storeUrl>")
    .description("Fork a stored run at a given event id")
    .requiredOption("--at-event <evt>", "Event id to fork at")
    .option("--run-id <id>", "Source run id")
    .option("--label <label>", "Optional label for the fork")
    .action(async (storeUrl: string, opts: { atEvent: string; runId?: string; label?: string }) =>
      set(await forkCmd(storeUrl, opts)),
    );

  await program.parseAsync(["node", "activegraph", ...argv]);
  return exitCode;
}

function out(s: string): void {
  // biome-ignore lint/suspicious/noConsole: CLI output
  console.log(s);
}

// --- quickstart ----------------------------------------------------------

async function quickstart(): Promise<number> {
  clearRegistry();
  defineBehavior({
    name: "echo",
    on: ["goal.created"],
    handler: (event, graph) => {
      graph.addObject("note", { text: `saw goal: ${String(event.payload.goal)}` });
    },
  });
  const graph = new Graph();
  const store = new InMemoryEventStore(graph.runId);
  const runtime = new Runtime(graph, { store });
  await runtime.runGoal("hello, active graph");
  new Trace(graph).print();
  return 0;
}

// --- behaviors -----------------------------------------------------------

function behaviorsCmd(): number {
  const registry = getRegistry();
  if (registry.length === 0) {
    out("(no behaviors registered)");
    return 0;
  }
  for (const b of registry) {
    const meta: string[] = [];
    if (b.on.length > 0) meta.push(`on=${b.on.join(",")}`);
    if (b.pattern !== null) meta.push(`pattern=${JSON.stringify(b.pattern).slice(0, 40)}`);
    if (b.activateAfter !== null) meta.push(`activateAfter=${b.activateAfter}`);
    out(`${b.kind.padEnd(18)} ${b.name.padEnd(28)} ${meta.join(" ")}`);
  }
  return 0;
}

// --- inspect -------------------------------------------------------------

async function inspectCmd(
  storeUrl: string,
  opts: { runId?: string; count?: string },
): Promise<number> {
  const store = openStore(storeUrl, opts.runId !== undefined ? { runId: opts.runId } : {});
  const limit = Number.parseInt(opts.count ?? "20", 10);
  type Ev = ReturnType<typeof makeEvent>;
  const all: Ev[] = [];
  for await (const ev of store.iterEvents() as AsyncIterable<Ev>) {
    all.push(ev);
  }
  const slice = all.slice(-limit);
  out(`run: ${store.runId} — ${all.length} events (showing last ${slice.length})`);
  for (const ev of slice) {
    out(
      `  ${ev.id.padEnd(10)} ${ev.type.padEnd(28)} ${(ev.actor ?? "-").padEnd(12)} ${ev.timestamp}`,
    );
  }
  await store.close();
  return 0;
}

// --- migrate -------------------------------------------------------------

async function migrateCmd(opts: { from: string; to: string; runId?: string }): Promise<number> {
  const fromStore = openStore(opts.from, opts.runId !== undefined ? { runId: opts.runId } : {});
  const toStore = openStore(opts.to, opts.runId !== undefined ? { runId: opts.runId } : {});
  const report = await migrate({ from: fromStore, to: toStore });
  out(JSON.stringify(report, null, 2));
  await fromStore.close();
  await toStore.close();
  return report.ok ? 0 : 1;
}

// --- replay --------------------------------------------------------------

async function replayCmd(
  storeUrl: string,
  opts: { strict?: boolean; runId?: string },
): Promise<number> {
  const store = openStore(storeUrl, opts.runId !== undefined ? { runId: opts.runId } : {});
  try {
    const runtime = await Runtime.load(store, { strict: opts.strict === true });
    out(`loaded run ${runtime.graph.runId} (${runtime.graph.events.length} events replayed)`);
    return 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    out(`replay failed: ${msg}`);
    return 1;
  } finally {
    await store.close();
  }
}

// --- fork ----------------------------------------------------------------

async function forkCmd(
  storeUrl: string,
  opts: { atEvent: string; runId?: string; label?: string },
): Promise<number> {
  const store = openStore(storeUrl, opts.runId !== undefined ? { runId: opts.runId } : {});
  try {
    const parent = await Runtime.load(store);
    const fork = parent.fork(
      opts.atEvent,
      opts.label !== undefined ? { label: opts.label } : {},
    );
    out(`forked ${parent.graph.runId} at ${opts.atEvent} → ${fork.graph.runId}`);
    const diff = structuralDiff(parent.graph, fork.graph);
    out(JSON.stringify({ forkRunId: fork.graph.runId, diff: summarizeDiff(diff) }, null, 2));
    return 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    out(`fork failed: ${msg}`);
    return 1;
  } finally {
    await store.close();
  }
}

function summarizeDiff(diff: ReturnType<typeof structuralDiff>): {
  objects: { onlyInParent: number; onlyInFork: number; divergent: number };
  relations: { onlyInParent: number; onlyInFork: number; divergent: number };
} {
  return {
    objects: {
      onlyInParent: diff.objects.onlyInA.length,
      onlyInFork: diff.objects.onlyInB.length,
      divergent: diff.objects.divergent.length,
    },
    relations: {
      onlyInParent: diff.relations.onlyInA.length,
      onlyInFork: diff.relations.onlyInB.length,
      divergent: diff.relations.divergent.length,
    },
  };
}
