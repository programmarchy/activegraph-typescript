// Per-behavior policy. Permissive by default; the runtime gates LLM /
// tool spend and approval-required mutations against these fields.

export interface Policy {
  behavior?: string;
  canCreate: string[];
  canCreateRelation: string[];
  canPropose: string[];
  canApply: string[];
  canCallTool: string[];
  requiresApproval: string[];
}

export function makePolicy(init: Partial<Policy> = {}): Policy {
  return {
    ...(init.behavior !== undefined ? { behavior: init.behavior } : {}),
    canCreate: init.canCreate ?? [],
    canCreateRelation: init.canCreateRelation ?? [],
    canPropose: init.canPropose ?? [],
    canApply: init.canApply ?? [],
    canCallTool: init.canCallTool ?? [],
    requiresApproval: init.requiresApproval ?? [],
  };
}
