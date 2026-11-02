import { err, ok, type Result } from "@/types/result";

export type ProjectState = "planned" | "active" | "on-hold" | "completed" | "canceled" | "archived";
type UnarchivedState = Exclude<ProjectState, "archived">;
export type ProjectAction =
  | "start"
  | "hold"
  | "resume"
  | "complete"
  | "cancel"
  | "archive"
  | "restore"
  | "reopen";

export type ProjectSnapshot = Readonly<{
  state: ProjectState;
  revision: number;
  archivedFrom: UnarchivedState | null;
}>;
export type ProjectCommand = Readonly<{
  action: ProjectAction;
  expectedRevision: number;
  reason?: string;
}>;
export type ProjectTransitionReceipt = Readonly<{
  policyVersion: 1;
  action: ProjectAction;
  from: ProjectState;
  to: ProjectState;
  previousRevision: number;
  revision: number;
  reason: string | null;
}>;
type TransitionFailure =
  | "revision_conflict"
  | "invalid_transition"
  | "reason_required"
  | "revision_exhausted";

const transitions: Record<
  Exclude<ProjectAction, "restore">,
  Partial<Record<ProjectState, ProjectState>>
> = {
  start: { planned: "active" },
  hold: { active: "on-hold" },
  resume: { "on-hold": "active" },
  complete: { active: "completed" },
  cancel: { planned: "canceled", active: "canceled", "on-hold": "canceled" },
  archive: {
    planned: "archived",
    active: "archived",
    "on-hold": "archived",
    completed: "archived",
    canceled: "archived",
  },
  reopen: { completed: "planned", canceled: "planned" },
};

function destination(current: ProjectSnapshot, action: ProjectAction): ProjectState | null {
  if (action === "restore") return current.state === "archived" ? current.archivedFrom : null;
  return transitions[action][current.state] ?? null;
}

// A pure decision only. Callers must authorize and persist using transactional revision CAS.
export function transitionProject(
  current: ProjectSnapshot,
  command: ProjectCommand,
): Result<
  Readonly<{ next: ProjectSnapshot; receipt: ProjectTransitionReceipt }>,
  TransitionFailure
> {
  if (current.revision !== command.expectedRevision) return err("revision_conflict");
  const to = destination(current, command.action);
  if (to === null) return err("invalid_transition");
  const reason = command.reason?.trim() ?? "";
  if (
    ["hold", "cancel", "archive", "restore", "reopen"].includes(command.action) &&
    reason.length === 0
  ) {
    return err("reason_required");
  }
  if (current.revision >= Number.MAX_SAFE_INTEGER) return err("revision_exhausted");
  const revision = current.revision + 1;
  return ok({
    next: {
      state: to,
      revision,
      archivedFrom: to === "archived" && current.state !== "archived" ? current.state : null,
    },
    receipt: {
      policyVersion: 1,
      action: command.action,
      from: current.state,
      to,
      previousRevision: current.revision,
      revision,
      reason: reason.length === 0 ? null : reason,
    },
  });
}
