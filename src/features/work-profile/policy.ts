import { sql } from "drizzle-orm";
import type { PermissionFlagKey } from "@/constants/permissionFlags";
import { canSee } from "@/features/permissions/canSee";
import type { PermSetUser } from "@/features/permissions/effective";
import { dealVisibilityPredicate } from "@/features/permissions/sql";
import { workItems } from "./schema";
export type WorkActor = PermSetUser;
export function allowed(actor: WorkActor, flag: string): boolean {
  return actor.isActive && (actor.type === "admin" || actor.flags.has(flag as PermissionFlagKey));
}
export const managesProfile = (actor: WorkActor) =>
  allowed(actor, "company.profile.manage") || allowed(actor, "permissions.manage");
export function visible(
  actor: WorkActor,
  row: { ownerId: string; visibility: "owner" | "all" | "group"; visibilityGroupId: string | null },
): boolean {
  return canSee(actor, {
    kind: "organization",
    ownerId: row.ownerId,
    visibilityLevel: row.visibility,
    visibilityGroupId: row.visibilityGroupId,
    visibleToUserIds: [],
  });
}
export function itemVisibility(actor: WorkActor) {
  return dealVisibilityPredicate(
    {
      userId: actor.id,
      isAdmin: actor.type === "admin",
      isActive: actor.isActive,
      sessionLive: true,
      groupIds: [...actor.groupIds],
      managedUserIds: [...(actor.managedUserIds ?? [])],
    },
    {
      ownerId: sql`${workItems.ownerId}`,
      visibilityLevel: sql`${workItems.visibility}`,
      visibilityGroupId: sql`${workItems.visibilityGroupId}`,
      visibleToUserIds: sql`ARRAY[]::uuid[]`,
      pipelineVisibilityGroupId: sql`NULL::uuid`,
    },
  );
}
export const referenceSession = (actor: WorkActor) => ({
  userId: actor.id,
  isActive: actor.isActive,
  sessionLive: true,
  isAdmin: actor.type === "admin",
  visibilityGroupIds: [...actor.groupIds],
  managedUserIds: [...(actor.managedUserIds ?? [])],
});
