// EventStore conformance suite.
//
// A list of named, runner-agnostic test cases. Concrete stores wire these
// into a vitest (or other) test file so the store-memory package itself
// doesn't take a runtime dependency on a test framework.
//
// Example:
//
//   import { describe, it, expect } from "vitest";
//   import { conformanceCases, InMemoryEventStore } from "@activegraph/store-memory";
//
//   describe("InMemoryEventStore", () => {
//     for (const c of conformanceCases) {
//       it(c.name, async () => {
//         await c.run({ makeStore: (runId) => new InMemoryEventStore(runId) }, expect);
//       });
//     }
//   });

import type { Event } from "@activegraph/core";
import { makeEvent } from "@activegraph/core";

import type { EventStore } from "./base.js";

export interface ConformanceContext {
  /** Construct a fresh, empty EventStore for `runId`. */
  makeStore(runId: string): EventStore;
  /** Tear down any resources. Called after each case. */
  cleanup?(): void;
}

/**
 * Minimal expect-shaped assertion helper. Match vitest/jest signatures so a
 * consumer can pass through the real `expect` directly.
 */
export interface ExpectLike {
  (actual: unknown): {
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
    rejects: { toThrow(): Promise<void> };
  };
}

export interface ConformanceCase {
  name: string;
  run(ctx: ConformanceContext, expect: ExpectLike): Promise<void>;
}

function ev(id: string, payload: Record<string, unknown> = { k: "v" }): Event {
  return makeEvent({
    id,
    type: "object.created",
    payload,
    actor: "test",
    timestamp: "2026-01-01T00:00:00Z",
  });
}

async function toArray<T>(it: AsyncIterable<T> | Iterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it as AsyncIterable<T>) out.push(x);
  return out;
}

export const conformanceCases: ConformanceCase[] = [
  {
    name: "append then iterEvents preserves order",
    async run(ctx, expect) {
      const store = ctx.makeStore("run_conformance_1");
      try {
        for (let i = 0; i < 5; i++) await store.append(ev(`evt_${i}`));
        const events = await toArray(store.iterEvents());
        expect(events.map((e) => e.id)).toEqual(["evt_0", "evt_1", "evt_2", "evt_3", "evt_4"]);
      } finally {
        ctx.cleanup?.();
      }
    },
  },
  {
    name: "count reports number of appended events",
    async run(ctx, expect) {
      const store = ctx.makeStore("run_conformance_2");
      try {
        expect(await store.count()).toBe(0);
        await store.append(ev("evt_a"));
        await store.append(ev("evt_b"));
        expect(await store.count()).toBe(2);
      } finally {
        ctx.cleanup?.();
      }
    },
  },
  {
    name: "getEvent returns null for unknown ids",
    async run(ctx, expect) {
      const store = ctx.makeStore("run_conformance_3");
      try {
        await store.append(ev("evt_known"));
        const got = await store.getEvent("evt_known");
        expect(got?.id).toBe("evt_known");
        expect(await store.getEvent("evt_missing")).toBe(null);
      } finally {
        ctx.cleanup?.();
      }
    },
  },
  {
    name: "iterEvents({ after }) skips the named id",
    async run(ctx, expect) {
      const store = ctx.makeStore("run_conformance_4");
      try {
        for (let i = 0; i < 4; i++) await store.append(ev(`evt_${i}`));
        const tail = await toArray(store.iterEvents({ after: "evt_1" }));
        expect(tail.map((e) => e.id)).toEqual(["evt_2", "evt_3"]);
      } finally {
        ctx.cleanup?.();
      }
    },
  },
  {
    name: "iterEvents({ until }) includes the named id",
    async run(ctx, expect) {
      const store = ctx.makeStore("run_conformance_5");
      try {
        for (let i = 0; i < 4; i++) await store.append(ev(`evt_${i}`));
        const head = await toArray(store.iterEvents({ until: "evt_2" }));
        expect(head.map((e) => e.id)).toEqual(["evt_0", "evt_1", "evt_2"]);
      } finally {
        ctx.cleanup?.();
      }
    },
  },
  {
    name: "truncateAfter drops the tail",
    async run(ctx, expect) {
      const store = ctx.makeStore("run_conformance_6");
      try {
        for (let i = 0; i < 5; i++) await store.append(ev(`evt_${i}`));
        await store.truncateAfter("evt_2");
        const remaining = await toArray(store.iterEvents());
        expect(remaining.map((e) => e.id)).toEqual(["evt_0", "evt_1", "evt_2"]);
      } finally {
        ctx.cleanup?.();
      }
    },
  },
  {
    name: "payload round-trip preserves nested / unicode / null",
    async run(ctx, expect) {
      const store = ctx.makeStore("run_conformance_7");
      try {
        const payload = {
          nested: { k: [1, 2, { a: "b" }] },
          unicode: "café — 🚀",
          empty: [],
          null_in_value: null,
        };
        await store.append(ev("evt_payload", payload));
        const got = await store.getEvent("evt_payload");
        expect(got?.payload).toEqual(payload);
      } finally {
        ctx.cleanup?.();
      }
    },
  },
  {
    name: "duplicate id in same run is rejected",
    async run(ctx, expect) {
      const store = ctx.makeStore("run_conformance_8");
      try {
        await store.append(ev("evt_dup"));
        await expect(async () => store.append(ev("evt_dup"))).rejects.toThrow();
      } finally {
        ctx.cleanup?.();
      }
    },
  },
  {
    name: "close is idempotent",
    async run(ctx, _expect) {
      const store = ctx.makeStore("run_conformance_9");
      try {
        await store.append(ev("evt_a"));
        await store.close();
        await store.close();
      } finally {
        ctx.cleanup?.();
      }
    },
  },
];
