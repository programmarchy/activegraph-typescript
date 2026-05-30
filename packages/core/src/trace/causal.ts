// Causal-chain audit. Walk back from an object through caused_by links
// until we hit a goal.created (or an event with no parent).

import type { Event } from "../event.js";
import type { Graph } from "../graph.js";

export function causalChain(graph: Graph, objectId: string): string {
  const obj = graph.getObject(objectId);
  if (obj === undefined) return `(no such object: ${objectId})`;

  const byId = new Map<string, Event>();
  for (const e of graph.events) byId.set(e.id, e);

  let createdByEvt: Event | undefined;
  for (const e of graph.events) {
    if (e.type === "object.created") {
      const o = e.payload.object as Record<string, unknown> | undefined;
      if (o !== undefined && o.id === objectId) {
        createdByEvt = e;
        break;
      }
    }
  }

  const lines: string[] = [];
  const dataAny = obj.data as Record<string, unknown>;
  const label = (dataAny.title ?? dataAny.text ?? "") as string;
  const labelS = label !== "" ? ` "${label}"` : "";
  lines.push(`${obj.id} (${obj.type})${labelS}`);

  const llmRequestId = obj.provenance.llm_request_event_id as string | undefined;
  const toolRequestIds = (obj.provenance.tool_request_event_ids as string[] | undefined) ?? [];
  let indent = "  ";

  if (llmRequestId !== undefined) {
    const llmReq = byId.get(llmRequestId);
    if (llmReq !== undefined) {
      const llmResp = findResponseFor(byId, llmRequestId, "llm.responded");
      const actor = llmReq.actor ?? "?";
      const model = (llmReq.payload.model as string | undefined) ?? "?";
      lines.push(`${indent}← ${actor} (${llmReq.id}) llm.requested  model=${model}`);
      if (llmResp !== undefined) {
        const cost = llmResp.payload.cost_usd;
        const cached = llmResp.payload.cache_hit;
        const tail = cached
          ? " (cache_hit)"
          : cost !== undefined && cost !== null
            ? ` cost=$${fmtMoney(cost)}`
            : "";
        lines.push(`${indent}  (${llmResp.id}) llm.responded${tail}`);
      }
    }
  }

  for (const trId of toolRequestIds) {
    const tr = byId.get(trId);
    if (tr === undefined) continue;
    const tresp = findResponseFor(byId, trId, "tool.responded");
    const toolName = (tr.payload.tool as string | undefined) ?? "?";
    lines.push(`${indent}← ${tr.actor ?? "?"} (${tr.id}) tool.requested  tool=${toolName}`);
    if (tresp !== undefined) {
      const cost = tresp.payload.cost_usd;
      const cached = tresp.payload.cache_hit;
      const err = tresp.payload.error;
      let tail: string;
      if (err !== undefined && err !== null) {
        const reason =
          typeof err === "object" ? ((err as Record<string, unknown>).reason ?? "tool.error") : "tool.error";
        tail = ` error=${String(reason)}`;
      } else if (cached) {
        tail = " (cache_hit)";
      } else if (cost !== undefined && cost !== null) {
        tail = ` cost=$${fmtMoney(cost)}`;
      } else {
        tail = "";
      }
      lines.push(`${indent}  (${tresp.id}) tool.responded${tail}`);
    }
  }

  const seen = new Set<string>();
  let cursor: Event | undefined = createdByEvt;
  while (cursor !== undefined) {
    if (seen.has(cursor.id)) {
      lines.push(`${indent}← (cycle at ${cursor.id})`);
      break;
    }
    seen.add(cursor.id);
    const actor = cursor.actor ?? "?";
    lines.push(`${indent}← ${actor} (${cursor.id}) ${cursor.type}`);
    if (cursor.causedBy === null) break;
    cursor = byId.get(cursor.causedBy);
    indent += "  ";
  }

  return lines.join("\n");
}

function findResponseFor(
  byId: Map<string, Event>,
  requestId: string,
  responseType: string,
): Event | undefined {
  for (const e of byId.values()) {
    if (e.type === responseType && e.causedBy === requestId) return e;
  }
  return undefined;
}

function fmtMoney(v: unknown): string {
  const n = Number(v);
  if (Number.isFinite(n)) return n.toFixed(3);
  return String(v);
}
