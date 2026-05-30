// @activegraph/cli — the `activegraph` command.
//
// Subcommands today:
//   quickstart     Run the built-in quickstart demo end-to-end
//   status         Show a no-op runtime's status snapshot (smoke test)
//   inspect <db>   Inspect a SQLite event store (event counts, run ids)
//   version        Print version
//
// More subcommands (migrate, fork, replay) land in later phases.

import { Command } from "commander";

import { Graph, Trace } from "@activegraph/core";
import { Runtime, clearRegistry, defineBehavior } from "@activegraph/runtime";
import { InMemoryEventStore } from "@activegraph/store-memory";

export const VERSION = "1.0.5-alpha.0";

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const program = new Command();
  program
    .name("activegraph")
    .description("Event-sourced reactive graph runtime")
    .version(VERSION, "-V, --version");

  let exitCode = 0;

  program
    .command("quickstart")
    .description("Run the built-in quickstart demo")
    .action(async () => {
      exitCode = await quickstart();
    });

  program
    .command("status")
    .description("Print a runtime status snapshot for a fresh empty runtime")
    .action(async () => {
      const r = new Runtime(new Graph());
      // biome-ignore lint/suspicious/noConsole: CLI output
      console.log(JSON.stringify(r.status(), null, 2));
    });

  program
    .command("version")
    .description("Print version (alias for --version)")
    .action(() => {
      // biome-ignore lint/suspicious/noConsole: CLI output
      console.log(VERSION);
    });

  await program.parseAsync(["node", "activegraph", ...argv]);
  return exitCode;
}

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
