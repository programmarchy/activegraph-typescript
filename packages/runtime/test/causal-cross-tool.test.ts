// Causal chain walks across tool boundaries — when a behavior creates
// an object using a tool, the chain renders the tool round-trip.

import { beforeEach, describe, expect, it } from "vitest";

import { FrozenClock, Graph, IDGen, causalChain } from "@activegraph/core";
import { clearToolRegistry, defineTool } from "@activegraph/tools";

import { Runtime, clearRegistry, defineBehavior } from "../src/index.js";

function newGraph(): Graph {
  return new Graph({ ids: new IDGen(), clock: new FrozenClock() });
}

describe("Causal chain across tool boundary", () => {
  beforeEach(() => {
    clearRegistry();
    clearToolRegistry();
  });

  it("renders tool.requested in the chain when provenance threads tool ids", async () => {
    defineTool({
      name: "fetch",
      handler: async (args: { url: string }) => ({ output: `data:${args.url}` }),
    });

    defineBehavior({
      name: "puller",
      on: ["goal.created"],
      handler: async (event, graph, ctx) => {
        const r = await ctx.callTool<{ url: string }, string>("fetch", { url: "x" });
        // Find the most recent tool.requested event (the one our call emitted).
        const toolReq = graph.events.filter((e) => e.type === "tool.requested").at(-1)!;
        graph.addObject(
          "artifact",
          { content: r.output },
          {
            actor: "puller",
            causedBy: event.id,
            toolRequestEventIds: [toolReq.id],
          },
        );
      },
    });

    const g = newGraph();
    await new Runtime(g).runGoal("fetch and save");

    const artifact = g.allObjects().find((o) => o.type === "artifact")!;
    const chain = causalChain(g, artifact.id);
    expect(chain).toContain(artifact.id);
    expect(chain).toContain("tool.requested");
    expect(chain).toContain("tool.responded");
    expect(chain).toContain("tool=fetch");
    // And up the chain to the goal.
    expect(chain).toContain("goal.created");
  });
});
