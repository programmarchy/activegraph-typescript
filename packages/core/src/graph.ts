// Object, Relation, Graph + projector.
//
// Strict invariant: Graph state is materialized from the event log.
// `emit(event)` is the only mutator. Convenience methods (addObject,
// addRelation, patchObject, proposePatch, applyPatch, etc.) all build an
// Event and call emit.
//
// Provenance: every object/relation/patch carries a provenance object
// written by the graph, never by the behavior — any `provenance` key on
// caller-supplied `data` is stripped.

import type { Clock } from "./clock.js";
import { WallClock } from "./clock.js";
import type { Event, EventPayload } from "./event.js";
import { makeEvent } from "./event.js";
import { IDGen } from "./ids.js";
import { internalBugFields, ExecutionError } from "./errors.js";
import type { Patch, PatchOp } from "./patch.js";
import { patchFromJSON, patchToJSON } from "./patch.js";

// ---------- handles -------------------------------------------------------

export interface ObjectNode {
  id: string;
  type: string;
  data: Record<string, unknown>;
  version: number;
  provenance: Record<string, unknown>;
}

export interface Relation {
  id: string;
  source: string;
  target: string;
  type: string;
  data: Record<string, unknown>;
  provenance: Record<string, unknown>;
}

export type EventListener = (event: Event) => void;

export interface EventStoreSink {
  append(event: Event): void | Promise<void>;
}

export type ObjectValidator = (
  type: string,
  data: Record<string, unknown>,
) => Record<string, unknown>;

export type RelationValidator = (
  type: string,
  sourceType: string | null,
  targetType: string | null,
) => void;

// ---------- graph ---------------------------------------------------------

export interface GraphOptions {
  ids?: IDGen;
  clock?: Clock;
  runId?: string;
}

interface MutationMeta {
  actor?: string;
  causedBy?: string | null;
  frameId?: string | null;
  evidence?: string[];
  rationale?: string | null;
  llmRequestEventId?: string | null;
  toolRequestEventIds?: string[] | null;
}

export class Graph {
  readonly ids: IDGen;
  readonly clock: Clock;
  readonly runId: string;

  /**
   * Fork lineage. Set on the fork's graph by Runtime.fork(); null on a
   * root run. Persisted alongside the run record by stores that track it.
   */
  parentRunId: string | null = null;
  forkedAtEventId: string | null = null;
  label: string | null = null;

  /** @internal */ readonly _objects = new Map<string, ObjectNode>();
  /** @internal */ readonly _relations = new Map<string, Relation>();
  /** @internal */ readonly _patches = new Map<string, Patch>();
  /** @internal */ readonly _events: Event[] = [];
  /** @internal */ readonly _listeners: EventListener[] = [];
  /** @internal */ readonly _replayedIds = new Set<string>();
  /** @internal */ _store: EventStoreSink | null = null;

  /** @internal */ packObjectValidator: ObjectValidator | null = null;
  /** @internal */ packRelationValidator: RelationValidator | null = null;

  constructor(opts: GraphOptions = {}) {
    this.ids = opts.ids ?? new IDGen();
    this.clock = opts.clock ?? new WallClock();
    this.runId = opts.runId ?? this.ids.run();
  }

  // ---------- read API ----------

  get events(): readonly Event[] {
    return this._events;
  }

  get replayedIds(): ReadonlySet<string> {
    return this._replayedIds;
  }

  getObject(id: string): ObjectNode | undefined {
    return this._objects.get(id);
  }

  getRelation(id: string): Relation | undefined {
    return this._relations.get(id);
  }

  getPatch(id: string): Patch | undefined {
    return this._patches.get(id);
  }

  allObjects(): ObjectNode[] {
    return Array.from(this._objects.values());
  }

  allRelations(): Relation[] {
    return Array.from(this._relations.values());
  }

  getRelations(
    opts: { objectId?: string; type?: string; direction?: "outgoing" | "incoming" | "both" } = {},
  ): Relation[] {
    const direction = opts.direction ?? "both";
    const out: Relation[] = [];
    for (const r of this._relations.values()) {
      if (opts.type !== undefined && r.type !== opts.type) continue;
      if (opts.objectId !== undefined) {
        if (direction === "outgoing" && r.source !== opts.objectId) continue;
        if (direction === "incoming" && r.target !== opts.objectId) continue;
        if (direction === "both" && r.source !== opts.objectId && r.target !== opts.objectId) {
          continue;
        }
      }
      out.push(r);
    }
    return out;
  }

  relations(opts: { source?: string; target?: string; type?: string } = {}): Relation[] {
    const out: Relation[] = [];
    for (const r of this._relations.values()) {
      if (opts.source !== undefined && r.source !== opts.source) continue;
      if (opts.target !== undefined && r.target !== opts.target) continue;
      if (opts.type !== undefined && r.type !== opts.type) continue;
      out.push(r);
    }
    return out;
  }

  neighborhood(objectId: string, depth = 1): { objects: ObjectNode[]; relations: Relation[] } {
    if (!this._objects.has(objectId)) return { objects: [], relations: [] };
    const seenObjs = new Set<string>([objectId]);
    let frontier = new Set<string>([objectId]);
    const seenRels = new Set<string>();
    for (let i = 0; i < depth; i++) {
      const next = new Set<string>();
      for (const r of this._relations.values()) {
        if (frontier.has(r.source) || frontier.has(r.target)) {
          seenRels.add(r.id);
          if (!seenObjs.has(r.source)) next.add(r.source);
          if (!seenObjs.has(r.target)) next.add(r.target);
        }
      }
      for (const id of next) seenObjs.add(id);
      frontier = next;
      if (frontier.size === 0) break;
    }
    return {
      objects: [...seenObjs].flatMap((id) => {
        const o = this._objects.get(id);
        return o ? [o] : [];
      }),
      relations: [...seenRels].flatMap((id) => {
        const r = this._relations.get(id);
        return r ? [r] : [];
      }),
    };
  }

  objects(opts: { type?: string; where?: WhereClause } = {}): ObjectNode[] {
    const out: ObjectNode[] = [];
    for (const o of this._objects.values()) {
      if (opts.type !== undefined && o.type !== opts.type) continue;
      if (opts.where && !evalWhereOnObject(opts.where, o)) continue;
      out.push(o);
    }
    return out;
  }

  hasObjectOfType(type: string): boolean {
    for (const o of this._objects.values()) {
      if (o.type === type) return true;
    }
    return false;
  }

  // ---------- listener API ----------

  addListener(fn: EventListener): void {
    this._listeners.push(fn);
  }

  // ---------- store attachment ----------

  attachStore(store: EventStoreSink): void {
    if (this._store === store) return;
    if (this._store !== null) {
      throw new ExecutionError("graph already has a store attached", {
        whatFailed:
          "Graph.attachStore() was called, but this graph already has a store. Stores attach at most once per graph lifetime.",
        why: "A graph's store is the durability target for every event it emits. Re-attaching a second store would either split the event log across two stores or attempt a hidden migration; the framework refuses re-attach so neither failure mode is reachable silently.",
        howToFix:
          "If you want to copy the graph's run to a new store, run the migration primitive on the existing store's URL after the run completes. If the graph is fresh, construct a new Graph rather than re-attaching.",
      });
    }
    this._store = store;
  }

  get store(): EventStoreSink | null {
    return this._store;
  }

  // ---------- the only mutator (live path) ----------

  emit(event: Event): Event {
    this._events.push(event);
    applyEvent(this, event);
    if (this._store !== null) {
      void this._store.append(event);
    }
    for (const listener of this._listeners) listener(event);
    return event;
  }

  /** @internal — replay path: project without persisting or notifying. */
  replayEvent(event: Event): void {
    this._events.push(event);
    applyEvent(this, event);
    this._replayedIds.add(event.id);
  }

  // ---------- convenience builders ----------

  addObject(
    type: string,
    data: Record<string, unknown>,
    meta: MutationMeta = {},
  ): ObjectNode {
    const objId = this.ids.object(type);
    let clean = stripProvenance(structuredClone(data));
    if (this.packObjectValidator !== null) {
      clean = this.packObjectValidator(type, clean);
    }
    const provenance = this.provenance(meta);
    const payload: EventPayload = {
      object: {
        id: objId,
        type,
        data: clean,
        version: 1,
        provenance,
      },
      id: objId,
    };
    this.emit(
      makeEvent({
        id: this.ids.event(),
        type: "object.created",
        payload,
        actor: meta.actor ?? "system",
        frameId: meta.frameId ?? null,
        causedBy: meta.causedBy ?? null,
        timestamp: this.clock.now(),
      }),
    );
    return this._objects.get(objId)!;
  }

  addRelation(
    source: string,
    target: string,
    type: string,
    data: Record<string, unknown> = {},
    meta: MutationMeta = {},
  ): Relation {
    const relId = this.ids.relation();
    const clean = stripProvenance(structuredClone(data));
    if (this.packRelationValidator !== null) {
      const srcObj = this._objects.get(source);
      const tgtObj = this._objects.get(target);
      this.packRelationValidator(type, srcObj?.type ?? null, tgtObj?.type ?? null);
    }
    const provenance = this.provenance({ ...meta, evidence: [] });
    const payload: EventPayload = {
      relation: {
        id: relId,
        source,
        target,
        type,
        data: clean,
        provenance,
      },
      id: relId,
      source,
      target,
    };
    this.emit(
      makeEvent({
        id: this.ids.event(),
        type: "relation.created",
        payload,
        actor: meta.actor ?? "system",
        frameId: meta.frameId ?? null,
        causedBy: meta.causedBy ?? null,
        timestamp: this.clock.now(),
      }),
    );
    return this._relations.get(relId)!;
  }

  removeRelation(relationId: string, meta: MutationMeta = {}): void {
    if (!this._relations.has(relationId)) return;
    this.emit(
      makeEvent({
        id: this.ids.event(),
        type: "relation.removed",
        payload: { id: relationId },
        actor: meta.actor ?? "system",
        frameId: meta.frameId ?? null,
        causedBy: meta.causedBy ?? null,
        timestamp: this.clock.now(),
      }),
    );
  }

  removeObject(objectId: string, meta: MutationMeta = {}): void {
    if (!this._objects.has(objectId)) return;
    this.emit(
      makeEvent({
        id: this.ids.event(),
        type: "object.removed",
        payload: { id: objectId },
        actor: meta.actor ?? "system",
        frameId: meta.frameId ?? null,
        causedBy: meta.causedBy ?? null,
        timestamp: this.clock.now(),
      }),
    );
  }

  patchObject(
    target: string,
    updates: Record<string, unknown>,
    meta: MutationMeta = {},
  ): Patch {
    const obj = this._objects.get(target);
    if (obj === undefined) {
      throw new Error(`unknown object: ${target}`);
    }
    const clean = stripProvenance(structuredClone(updates));
    const patch: Patch = {
      id: this.ids.patch(),
      target,
      op: "update",
      value: clean,
      expectedVersion: obj.version,
      proposedBy: meta.actor ?? "system",
      rationale: meta.rationale ?? null,
      evidence: [...(meta.evidence ?? [])],
      status: "applied",
      rejectionReason: null,
      provenance: this.provenance(meta),
    };
    const diff = diffFields(obj.data, clean);
    this.emit(
      makeEvent({
        id: this.ids.event(),
        type: "patch.applied",
        payload: {
          patch: patchToJSON(patch),
          target,
          diff,
        },
        actor: meta.actor ?? "system",
        frameId: meta.frameId ?? null,
        causedBy: meta.causedBy ?? null,
        timestamp: this.clock.now(),
      }),
    );
    return this._patches.get(patch.id)!;
  }

  proposePatch(
    target: string,
    op: PatchOp,
    value: Record<string, unknown>,
    meta: MutationMeta & { proposedBy: string },
  ): Patch {
    const normalized = target.includes(":") ? target.split(":", 2)[1]! : target;
    const obj = this._objects.get(normalized);
    const expectedVersion = obj?.version ?? 0;
    const clean = stripProvenance(structuredClone(value));
    const patch: Patch = {
      id: this.ids.patch(),
      target: normalized,
      op,
      value: clean,
      expectedVersion,
      proposedBy: meta.proposedBy,
      rationale: meta.rationale ?? null,
      evidence: [...(meta.evidence ?? [])],
      status: "proposed",
      rejectionReason: null,
      provenance: this.provenance({ ...meta, actor: meta.proposedBy }),
    };
    this.emit(
      makeEvent({
        id: this.ids.event(),
        type: "patch.proposed",
        payload: { patch: patchToJSON(patch) },
        actor: meta.proposedBy,
        frameId: meta.frameId ?? null,
        causedBy: meta.causedBy ?? null,
        timestamp: this.clock.now(),
      }),
    );
    return this._patches.get(patch.id)!;
  }

  applyPatch(
    patchId: string,
    meta: { approvedBy?: string; causedBy?: string | null; frameId?: string | null } = {},
  ): Event {
    const patch = this._patches.get(patchId);
    if (patch === undefined) throw new Error(`unknown patch: ${patchId}`);
    if (patch.status !== "proposed") {
      throw new ExecutionError(
        `patch ${patchId} is not in 'proposed' state (currently ${patch.status})`,
        {
          whatFailed: `Attempted to apply patch ${patchId}, but its current status is '${patch.status}'. The proposed → applied transition is the only valid path from proposed.`,
          why: "Patches are single-use. Once a patch is applied or rejected it is terminal; attempting to advance it again would either double-apply a mutation or contradict a prior rejection.",
          howToFix: "Create a new patch with proposePatch() if you need to repeat the mutation.",
        },
      );
    }
    const approvedBy = meta.approvedBy ?? "system";
    const targetObj = this._objects.get(patch.target);
    const currentVersion = targetObj?.version ?? 0;
    if (currentVersion !== patch.expectedVersion) {
      return this.rejectInternal(
        patchId,
        `version mismatch: expected ${patch.expectedVersion}, got ${currentVersion}`,
        approvedBy,
        meta.causedBy ?? null,
        meta.frameId ?? null,
      );
    }
    const diff = diffFields(targetObj?.data ?? {}, patch.value);
    return this.emit(
      makeEvent({
        id: this.ids.event(),
        type: "patch.applied",
        payload: {
          patch: { ...patchToJSON(patch), status: "applied" },
          target: patch.target,
          diff,
          approved_by: approvedBy,
        },
        actor: approvedBy,
        frameId: meta.frameId ?? null,
        causedBy: meta.causedBy ?? null,
        timestamp: this.clock.now(),
      }),
    );
  }

  rejectPatch(
    patchId: string,
    reason: string,
    meta: { actor?: string; causedBy?: string | null; frameId?: string | null } = {},
  ): Event {
    return this.rejectInternal(
      patchId,
      reason,
      meta.actor ?? "system",
      meta.causedBy ?? null,
      meta.frameId ?? null,
    );
  }

  private rejectInternal(
    patchId: string,
    reason: string,
    actor: string,
    causedBy: string | null,
    frameId: string | null,
  ): Event {
    const patch = this._patches.get(patchId);
    if (patch === undefined) throw new Error(`unknown patch: ${patchId}`);
    const current = this._objects.get(patch.target);
    return this.emit(
      makeEvent({
        id: this.ids.event(),
        type: "patch.rejected",
        payload: {
          patch_id: patchId,
          target: patch.target,
          reason,
          current_version: current?.version ?? 0,
        },
        actor,
        frameId,
        causedBy,
        timestamp: this.clock.now(),
      }),
    );
  }

  // ---------- provenance helper ----------

  private provenance(meta: MutationMeta): Record<string, unknown> {
    const p: Record<string, unknown> = {
      created_by: meta.actor ?? "system",
      caused_by_event: meta.causedBy ?? null,
      frame_id: meta.frameId ?? null,
      timestamp: this.clock.now(),
      evidence: [...(meta.evidence ?? [])],
      run_id: this.runId,
    };
    if (meta.llmRequestEventId !== undefined && meta.llmRequestEventId !== null) {
      p.llm_request_event_id = meta.llmRequestEventId;
    }
    if (meta.toolRequestEventIds && meta.toolRequestEventIds.length > 0) {
      p.tool_request_event_ids = [...meta.toolRequestEventIds];
    }
    return p;
  }
}

// ---------- the projector — single mutation code path -------------------

export function applyEvent(graph: Graph, event: Event): void {
  const t = event.type;
  const p = event.payload;

  if (t === "object.created") {
    const o = p.object as Record<string, unknown>;
    graph._objects.set(String(o.id), {
      id: String(o.id),
      type: String(o.type),
      data: structuredClone(o.data as Record<string, unknown>),
      version: Number(o.version),
      provenance: structuredClone(o.provenance as Record<string, unknown>),
    });
    return;
  }

  if (t === "object.removed") {
    const id = String(p.id);
    graph._objects.delete(id);
    const toDrop: string[] = [];
    for (const r of graph._relations.values()) {
      if (r.source === id || r.target === id) toDrop.push(r.id);
    }
    for (const rid of toDrop) graph._relations.delete(rid);
    return;
  }

  if (t === "relation.created") {
    const r = p.relation as Record<string, unknown>;
    graph._relations.set(String(r.id), {
      id: String(r.id),
      source: String(r.source),
      target: String(r.target),
      type: String(r.type),
      data: structuredClone(r.data as Record<string, unknown>),
      provenance: structuredClone(r.provenance as Record<string, unknown>),
    });
    return;
  }

  if (t === "relation.removed") {
    graph._relations.delete(String(p.id));
    return;
  }

  if (t === "patch.proposed") {
    const patch = patchFromJSON(p.patch as Record<string, unknown>);
    graph._patches.set(patch.id, patch);
    return;
  }

  if (t === "patch.applied") {
    const patch = patchFromJSON({ ...(p.patch as Record<string, unknown>), status: "applied" });
    graph._patches.set(patch.id, patch);
    const obj = graph._objects.get(patch.target);
    if (obj !== undefined) {
      if (patch.op === "update") {
        Object.assign(obj.data, patch.value);
      } else if (patch.op === "replace") {
        obj.data = structuredClone(patch.value);
      }
      obj.version += 1;
    }
    return;
  }

  if (t === "patch.rejected") {
    const existing = graph._patches.get(String(p.patch_id));
    if (existing !== undefined) {
      existing.status = "rejected";
      existing.rejectionReason = String(p.reason ?? "");
    }
    return;
  }
}

// ---------- helpers ------------------------------------------------------

function stripProvenance(data: Record<string, unknown>): Record<string, unknown> {
  if (data === null || typeof data !== "object" || Array.isArray(data)) return data;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (k !== "provenance") out[k] = v;
  }
  return out;
}

function diffFields(
  oldObj: Record<string, unknown>,
  updates: Record<string, unknown>,
): Record<string, { old: unknown; new: unknown }> {
  const out: Record<string, { old: unknown; new: unknown }> = {};
  for (const [k, newV] of Object.entries(updates)) {
    const hasOld = Object.prototype.hasOwnProperty.call(oldObj, k);
    const oldV = hasOld ? oldObj[k] : undefined;
    if (!hasOld || !shallowEqual(oldV, newV)) {
      out[k] = { old: hasOld ? oldV : null, new: newV };
    }
  }
  return out;
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (typeof a !== "object") return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

// ---------- where evaluator ---------------------------------------------

export type WhereClause = Record<string, unknown>;

type Op = ">" | "<" | ">=" | "<=" | "==" | "!=" | "in" | "not in";

const OPS: Record<Op, (a: unknown, b: unknown) => boolean> = {
  ">": (a, b) => a !== null && a !== undefined && compare(a, b) > 0,
  "<": (a, b) => a !== null && a !== undefined && compare(a, b) < 0,
  ">=": (a, b) => a !== null && a !== undefined && compare(a, b) >= 0,
  "<=": (a, b) => a !== null && a !== undefined && compare(a, b) <= 0,
  "==": (a, b) => shallowEqual(a, b),
  "!=": (a, b) => !shallowEqual(a, b),
  in: (a, b) => Array.isArray(b) && (b as unknown[]).includes(a),
  "not in": (a, b) => Array.isArray(b) && !(b as unknown[]).includes(a),
};

function compare(a: unknown, b: unknown): number {
  const aa = a as number | string;
  const bb = b as number | string;
  if (aa < bb) return -1;
  if (aa > bb) return 1;
  return 0;
}

function resolvePath(root: unknown, path: string[]): unknown {
  let cur: unknown = root;
  for (const seg of path) {
    if (cur === null || cur === undefined) return null;
    if (typeof cur === "object" && !Array.isArray(cur)) {
      cur = (cur as Record<string, unknown>)[seg];
    } else {
      return null;
    }
  }
  return cur ?? null;
}

export function evaluateWhere(where: WhereClause, root: unknown): boolean {
  for (const [key, expected] of Object.entries(where)) {
    const actual = resolvePath(root, key.split("."));
    if (expected !== null && typeof expected === "object" && !Array.isArray(expected)) {
      for (const [op, value] of Object.entries(expected as Record<string, unknown>)) {
        const fn = OPS[op as Op];
        if (fn === undefined) {
          const f = internalBugFields({
            summary: `unknown where operator: ${JSON.stringify(op)}`,
            whatHappened: `The view-filter evaluator received comparison operator ${JSON.stringify(op)}, but the operator table has no handler for it.`,
            whyInvariant:
              "The operator table is the source of truth for which comparison operators view filters accept. An unknown operator means either the filter was constructed by code that bypassed the parser, or the operator table drifted from the parser.",
            location: "@activegraph/core/graph.ts:evaluateWhere",
            extraContext: { operator: op },
          });
          throw new ExecutionError(f.summary, {
            whatFailed: f.whatFailed,
            why: f.why,
            howToFix: f.howToFix,
            context: f.context,
          });
        }
        if (!fn(actual, value)) return false;
      }
    } else if (!shallowEqual(actual, expected)) {
      return false;
    }
  }
  return true;
}

export function evalWhereOnObject(where: WhereClause, obj: ObjectNode): boolean {
  const root: Record<string, unknown> = {
    id: obj.id,
    type: obj.type,
    data: obj.data,
    version: obj.version,
    provenance: obj.provenance,
    ...obj.data,
  };
  return evaluateWhere(where, root);
}
