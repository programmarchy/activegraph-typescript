import { describe, expect, it } from "vitest";

import { InMemoryEventStore, conformanceCases } from "../src/index.js";

describe("InMemoryEventStore conformance", () => {
  for (const c of conformanceCases) {
    it(c.name, async () => {
      await c.run({ makeStore: (runId) => new InMemoryEventStore(runId) }, expect);
    });
  }
});
