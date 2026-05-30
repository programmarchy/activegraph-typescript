// Postgres conformance — runs the same suite as InMemory and SQLite.
// Gated by ACTIVEGRAPH_TEST_POSTGRES_URL.
//
// Each case uses a fresh runId on the same DB; the suite never touches
// non-test tables. Run:
//
//   docker run -d --rm -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:16
//   ACTIVEGRAPH_TEST_POSTGRES_URL=postgresql://postgres:postgres@localhost:5432/postgres \
//     pnpm vitest run packages/store-postgres

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { EventStore } from "@activegraph/store-memory";
import { conformanceCases } from "@activegraph/store-memory";

import { PostgresEventStore } from "../src/index.js";

const URL = process.env.ACTIVEGRAPH_TEST_POSTGRES_URL;

describe.runIf(URL !== undefined)("PostgresEventStore conformance", () => {
  let stores: EventStore[];

  beforeEach(() => {
    stores = [];
  });

  afterEach(async () => {
    for (const s of stores) {
      try {
        await s.close();
      } catch {
        // ignored
      }
    }
  });

  for (const c of conformanceCases) {
    it(c.name, async () => {
      let n = 0;
      await c.run(
        {
          makeStore: (runId) => {
            n += 1;
            const store = new PostgresEventStore({
              url: URL ?? "",
              runId: `${runId}_${Date.now()}_${n}`,
            });
            stores.push(store);
            return store;
          },
        },
        expect,
      );
    });
  }
});
