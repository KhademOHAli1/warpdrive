import type { PermSetUser } from "@/features/permissions/effective";

export type WorkflowCapability = "view" | "create" | "edit" | "publish" | "run" | "cancel";

export function canWorkflow(
  actor: PermSetUser,
  capability: WorkflowCapability,
  ownerId = actor.id,
): boolean {
  if (!actor.isActive) return false;
  if (actor.type === "admin") return true;
  return actor.id === ownerId && actor.flags.has(`workflow.${capability}`);
}
