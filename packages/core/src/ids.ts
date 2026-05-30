// ID generation. All IDs flow through one generator so tests can swap
// in a deterministic one.

import { randomBytes } from "node:crypto";

import type { Event } from "./event.js";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** 26-char Crockford base32 ULID. Time-prefixed, random suffix. */
function ulid(): string {
  const ms = BigInt(Date.now()) & ((1n << 48n) - 1n);
  const rand = BigInt("0x" + randomBytes(10).toString("hex"));
  let n = (ms << 80n) | rand;
  const out: string[] = [];
  for (let i = 0; i < 26; i++) {
    out.push(CROCKFORD[Number(n & 0x1fn)]!);
    n >>= 5n;
  }
  return out.reverse().join("");
}

const OBJ_RE = /^(?<type>[^#]+)#(?<n>\d+)$/;
const NUM_RE = /^[a-zA-Z]+_(?<n>\d+)$/;

/**
 * Per-graph monotonic ID generator. Not thread-safe — the runtime loop is
 * single-threaded.
 */
export class IDGen {
  private objectCounter = 0;
  private eventCounter = 0;
  private relationCounter = 0;
  private patchCounter = 0;
  private frameCounter = 0;

  object(type: string): string {
    this.objectCounter += 1;
    return `${type}#${this.objectCounter}`;
  }

  event(): string {
    this.eventCounter += 1;
    return `evt_${String(this.eventCounter).padStart(3, "0")}`;
  }

  relation(): string {
    this.relationCounter += 1;
    return `rel_${String(this.relationCounter).padStart(3, "0")}`;
  }

  patch(): string {
    this.patchCounter += 1;
    return `patch_${String(this.patchCounter).padStart(3, "0")}`;
  }

  frame(): string {
    this.frameCounter += 1;
    return `frame_${String(this.frameCounter).padStart(3, "0")}`;
  }

  run(): string {
    return ulid();
  }

  /**
   * Set counters past the highest id seen in `events`. Used after replay so
   * subsequent generators continue monotonically from the loaded log.
   */
  reseedFromEvents(events: Iterable<Event>): void {
    let maxObj = 0;
    let maxEvt = 0;
    let maxRel = 0;
    let maxPatch = 0;
    let maxFrame = 0;

    for (const e of events) {
      const n = suffixNum(e.id);
      if (n !== null) maxEvt = Math.max(maxEvt, n);
      if (e.frameId) {
        const fn = suffixNum(e.frameId);
        if (fn !== null) maxFrame = Math.max(maxFrame, fn);
      }
      const p = e.payload;
      if (e.type === "object.created") {
        const obj = (p.object as Record<string, unknown> | undefined) ?? {};
        const m = OBJ_RE.exec(String(obj.id ?? ""));
        if (m?.groups?.n) maxObj = Math.max(maxObj, Number(m.groups.n));
      } else if (e.type === "relation.created") {
        const rel = (p.relation as Record<string, unknown> | undefined) ?? {};
        const rn = suffixNum(String(rel.id ?? ""));
        if (rn !== null) maxRel = Math.max(maxRel, rn);
      } else if (e.type === "patch.proposed" || e.type === "patch.applied") {
        const patch = (p.patch as Record<string, unknown> | undefined) ?? {};
        const pn = suffixNum(String(patch.id ?? ""));
        if (pn !== null) maxPatch = Math.max(maxPatch, pn);
      } else if (e.type === "patch.rejected") {
        const pn = suffixNum(String(p.patch_id ?? ""));
        if (pn !== null) maxPatch = Math.max(maxPatch, pn);
      }
    }

    this.objectCounter = Math.max(this.objectCounter, maxObj);
    this.eventCounter = Math.max(this.eventCounter, maxEvt);
    this.relationCounter = Math.max(this.relationCounter, maxRel);
    this.patchCounter = Math.max(this.patchCounter, maxPatch);
    this.frameCounter = Math.max(this.frameCounter, maxFrame);
  }
}

function suffixNum(s: string): number | null {
  const m = NUM_RE.exec(s);
  if (!m?.groups?.n) return null;
  return Number(m.groups.n);
}
