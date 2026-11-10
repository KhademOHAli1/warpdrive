import type { users } from "@/db/schema/identity";
import { can } from "@/features/permissions/can";
import type { PermSetUser } from "@/features/permissions/effective";
import { err, ok, type Result } from "@/types/result";
import type { ProjectSnapshot } from "./projectLifecycle";

export type SelectedProjectStaff = Readonly<
  Pick<typeof users.$inferSelect, "id" | "isActive" | "invitedAt">
>;
export type ProjectCreationInput = Readonly<{
  actor: PermSetUser;
  creator: SelectedProjectStaff;
  selectedOwner: SelectedProjectStaff;
}>;
export type ProjectCreationPlan = Readonly<{
  ownerUserId: string;
  initial: ProjectSnapshot;
  creatorMembership: Readonly<{
    userId: string;
    projectEdit: true;
    assignmentCoordinate: false;
  }> | null;
}>;

function acceptedActiveStaff(staff: SelectedProjectStaff): boolean {
  return staff.isActive && staff.invitedAt === null;
}

// Plan from current native records; actual scope, admission and atomic insertion are caller work.
export function planProjectCreation(
  input: ProjectCreationInput,
): Result<ProjectCreationPlan, "project_creation_unavailable"> {
  const { actor, creator, selectedOwner } = input;
  if (
    !can(actor, "project.create") ||
    creator.id !== actor.id ||
    !acceptedActiveStaff(creator) ||
    !acceptedActiveStaff(selectedOwner)
  )
    return err("project_creation_unavailable");
  return ok({
    ownerUserId: selectedOwner.id,
    initial: { state: "planned", revision: 0, archivedFrom: null },
    creatorMembership:
      creator.id === selectedOwner.id
        ? null
        : { userId: creator.id, projectEdit: true, assignmentCoordinate: false },
  });
}
