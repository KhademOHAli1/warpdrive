import type { AuthUser } from "@/features/permissions/types";
import { err, ok, type Result } from "@/types/result";
import {
  type ProjectAction,
  type ProjectCommand,
  type ProjectSnapshot,
  transitionProject,
} from "./projectLifecycle";

export type ProjectMembershipFacts = Readonly<{
  projectId: string;
  userId: string;
  projectEdit: boolean;
  assignmentCoordinate: boolean;
}>;
export type ProjectLocalContext = Readonly<{
  actor: Pick<AuthUser, "id" | "type" | "isActive">;
  projectId: string;
  ownerUserId: string;
  membership: ProjectMembershipFacts | null;
}>;
export type ProjectLocalAction =
  | ProjectAction
  | "read"
  | "edit-content"
  | "manage-members"
  | "transfer-owner";
type LocalFailure = "project_local_access_denied" | "project_content_not_editable";
type LocalGrants = { owner: boolean; edit: boolean; coordinate: boolean };

const requiredGrant: Record<ProjectLocalAction, "read" | "edit" | "owner"> = {
  read: "read",
  "edit-content": "edit",
  start: "edit",
  hold: "edit",
  resume: "edit",
  complete: "edit",
  cancel: "owner",
  archive: "owner",
  restore: "owner",
  reopen: "owner",
  "manage-members": "owner",
  "transfer-owner": "owner",
};
const CONTENT_EDIT_STATES = new Set<ProjectSnapshot["state"]>(["planned", "active", "on-hold"]);

function localGrants(context: ProjectLocalContext): LocalGrants | null {
  if (!context.actor.isActive) return null;
  // Native administrator type supplies no private-project relation.
  if (context.actor.id === context.ownerUserId)
    return { owner: true, edit: true, coordinate: true };
  const member = context.membership;
  if (
    member === null ||
    member.projectId !== context.projectId ||
    member.userId !== context.actor.id
  )
    return null;
  return { owner: false, edit: member.projectEdit, coordinate: member.assignmentCoordinate };
}

// Trusted local facts only. Native module/session/CRM/Privacy/fence admission remains separate.
export function checkProjectLocalAction(
  context: ProjectLocalContext,
  snapshot: ProjectSnapshot,
  action: ProjectLocalAction,
): Result<true, LocalFailure> {
  const grants = localGrants(context);
  if (grants === null) return err("project_local_access_denied");
  const required = requiredGrant[action];
  if (required !== "read" && !grants[required]) return err("project_local_access_denied");
  if (action === "edit-content" && !CONTENT_EDIT_STATES.has(snapshot.state))
    return err("project_content_not_editable");
  return ok(true);
}

// This state-neutral grant cannot authorize an assignment command or its effects.
export function hasProjectAssignmentCoordinateEligibility(context: ProjectLocalContext): boolean {
  return localGrants(context)?.coordinate ?? false;
}

export function transitionProjectForLocalActor(
  context: ProjectLocalContext,
  snapshot: ProjectSnapshot,
  command: ProjectCommand,
) {
  const local = checkProjectLocalAction(context, snapshot, command.action);
  if (!local.ok) return local;
  return transitionProject(snapshot, command);
}
