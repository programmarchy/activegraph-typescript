// Frame — bounded mission context for a run.

export interface Frame {
  goal: string;
  id?: string;
  constraints: string[];
  successCriteria: string[];
  permissions: string[];
}

export function makeFrame(init: { goal: string } & Partial<Frame>): Frame {
  return {
    goal: init.goal,
    ...(init.id !== undefined ? { id: init.id } : {}),
    constraints: init.constraints ?? [],
    successCriteria: init.successCriteria ?? [],
    permissions: init.permissions ?? [],
  };
}
