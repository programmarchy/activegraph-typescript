// Structural diff between two graphs. Used by the fork-and-diff primitive.

import type { Graph, ObjectNode, Relation } from "@activegraph/core";

export interface DivergentObject {
  id: string;
  type: string;
  inA: ObjectNode | null;
  inB: ObjectNode | null;
  changedFields: string[];
}

export interface DivergentRelation {
  id: string;
  type: string;
  inA: Relation | null;
  inB: Relation | null;
}

export interface Diff {
  objects: {
    onlyInA: ObjectNode[];
    onlyInB: ObjectNode[];
    divergent: DivergentObject[];
  };
  relations: {
    onlyInA: Relation[];
    onlyInB: Relation[];
    divergent: DivergentRelation[];
  };
  eventCounts: { a: number; b: number };
}

export function structuralDiff(a: Graph, b: Graph): Diff {
  const aObjs = new Map(a.allObjects().map((o) => [o.id, o]));
  const bObjs = new Map(b.allObjects().map((o) => [o.id, o]));
  const aRels = new Map(a.allRelations().map((r) => [r.id, r]));
  const bRels = new Map(b.allRelations().map((r) => [r.id, r]));

  const onlyInAObjs: ObjectNode[] = [];
  const onlyInBObjs: ObjectNode[] = [];
  const divObjs: DivergentObject[] = [];
  for (const [id, ao] of aObjs) {
    const bo = bObjs.get(id);
    if (bo === undefined) {
      onlyInAObjs.push(ao);
      continue;
    }
    const changed = changedFields(ao.data, bo.data);
    if (changed.length > 0 || ao.version !== bo.version) {
      divObjs.push({ id, type: ao.type, inA: ao, inB: bo, changedFields: changed });
    }
  }
  for (const [id, bo] of bObjs) {
    if (!aObjs.has(id)) onlyInBObjs.push(bo);
  }

  const onlyInARels: Relation[] = [];
  const onlyInBRels: Relation[] = [];
  const divRels: DivergentRelation[] = [];
  for (const [id, ar] of aRels) {
    const br = bRels.get(id);
    if (br === undefined) {
      onlyInARels.push(ar);
      continue;
    }
    if (JSON.stringify(ar.data) !== JSON.stringify(br.data) || ar.type !== br.type) {
      divRels.push({ id, type: ar.type, inA: ar, inB: br });
    }
  }
  for (const [id, br] of bRels) {
    if (!aRels.has(id)) onlyInBRels.push(br);
  }

  return {
    objects: { onlyInA: onlyInAObjs, onlyInB: onlyInBObjs, divergent: divObjs },
    relations: { onlyInA: onlyInARels, onlyInB: onlyInBRels, divergent: divRels },
    eventCounts: { a: a.events.length, b: b.events.length },
  };
}

function changedFields(a: Record<string, unknown>, b: Record<string, unknown>): string[] {
  const keys = new Set<string>([...Object.keys(a), ...Object.keys(b)]);
  const out: string[] = [];
  for (const k of keys) {
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out.push(k);
  }
  return out;
}
