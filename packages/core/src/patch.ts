// Patch primitives. Single-target atomic mutations with optimistic
// concurrency via expected_version.

export type PatchOp = "create" | "update" | "replace" | "remove";
export type PatchStatus = "proposed" | "applied" | "rejected";

export const PATCH_OPS: readonly PatchOp[] = ["create", "update", "replace", "remove"];

export interface Patch {
  id: string;
  target: string;
  op: PatchOp;
  value: Record<string, unknown>;
  expectedVersion: number;
  proposedBy: string;
  rationale: string | null;
  evidence: string[];
  status: PatchStatus;
  rejectionReason: string | null;
  provenance: Record<string, unknown>;
}

export function patchToJSON(p: Patch): Record<string, unknown> {
  return {
    id: p.id,
    target: p.target,
    op: p.op,
    value: { ...p.value },
    expected_version: p.expectedVersion,
    proposed_by: p.proposedBy,
    rationale: p.rationale,
    evidence: [...p.evidence],
    status: p.status,
    rejection_reason: p.rejectionReason,
    provenance: { ...p.provenance },
  };
}

export function patchFromJSON(d: Record<string, unknown>): Patch {
  return {
    id: String(d.id),
    target: String(d.target),
    op: d.op as PatchOp,
    value: deepClone((d.value ?? {}) as Record<string, unknown>),
    expectedVersion: Number(d.expected_version ?? 0),
    proposedBy: String(d.proposed_by ?? ""),
    rationale: (d.rationale ?? null) as string | null,
    evidence: Array.isArray(d.evidence) ? [...(d.evidence as string[])] : [],
    status: (d.status ?? "proposed") as PatchStatus,
    rejectionReason: (d.rejection_reason ?? null) as string | null,
    provenance: deepClone((d.provenance ?? {}) as Record<string, unknown>),
  };
}

function deepClone<T>(v: T): T {
  return structuredClone(v);
}
