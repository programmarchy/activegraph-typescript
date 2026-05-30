import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { EventStore } from "@activegraph/store-memory";
import { conformanceCases } from "@activegraph/store-memory";

import { SQLiteEventStore } from "../src/index.js";

describe("SQLiteEventStore conformance", () => {
  let dir: string;
  let stores: EventStore[];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "activegraph-sqlite-"));
    stores = [];
  });

  afterEach(() => {
    for (const s of stores) {
      try {
        s.close();
      } catch {
        // ignored
      }
    }
    rmSync(dir, { recursive: true, force: true });
  });

  for (const c of conformanceCases) {
    it(c.name, async () => {
      let n = 0;
      await c.run(
        {
          makeStore: (runId) => {
            n += 1;
            const store = new SQLiteEventStore({
              path: join(dir, `case-${n}.db`),
              runId,
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
