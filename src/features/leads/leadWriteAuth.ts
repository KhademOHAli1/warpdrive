import { eq, inArray, or, type SQL, sql } from "drizzle-orm";
import type { PermissionFlagKey } from "@/constants/permissionFlags";
import { leads } from "@/db/schema/leads";
import { toVisibleDeal } from "@/features/deals/dealAuth";
import { can } from "@/features/permissions/can";
import type { PermSetUser } from "@/features/permissions/effective";
import type { LeadSession } from "./leadActions";

type LeadAction = "deal.edit" | "deal.delete";
type LeadVisibilityFields = Pick<
  typeof leads.$inferSelect,
  "ownerId" | "visibilityLevel" | "visibilityGroupId" | "visibleToUserIds"
>;

function actor(session: LeadSession): PermSetUser {
  return {
    id: session.userId,
    type: session.isAdmin ? "admin" : "regular",
    isActive: session.isActive && session.sessionLive,
    groupIds: new Set(session.visibilityGroupIds),
    managedUserIds: new Set(session.managedUserIds ?? []),
    flags: new Set(
      Object.entries(session.flags)
        .filter(([, enabled]) => enabled)
        .map(([name]) => name as PermissionFlagKey),
    ),
  };
}

// A lead has the deal visibility and edit policy, but no enclosing pipeline.
export function canLeadAction(
  session: LeadSession,
  action: LeadAction,
  lead: LeadVisibilityFields,
): boolean {
  return can(actor(session), action, toVisibleDeal(lead, null));
}

// Reapply the ownership part of can() in UPDATE ... WHERE so reassignment between
// the authorization read and the write cannot turn an own/team grant into an any grant.
export function leadActionClause(session: LeadSession, action: LeadAction): SQL {
  if (!session.isActive || !session.sessionLive) return sql`false`;
  if (session.isAdmin || session.flags[`${action}_any`] === true) return sql`true`;
  const predicates: SQL[] = [];
  if (session.flags[`${action}_own`] === true) predicates.push(eq(leads.ownerId, session.userId));
  if (action === "deal.edit" && session.flags["deal.edit_team"] === true) {
    const managed = session.managedUserIds ?? [];
    if (managed.length > 0) predicates.push(inArray(leads.ownerId, managed));
  }
  return predicates.length > 0 ? (or(...predicates) ?? sql`false`) : sql`false`;
}
