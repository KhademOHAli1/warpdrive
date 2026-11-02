import { type SQL, sql } from "drizzle-orm";
import { dealVisibilityPredicate } from "@/features/permissions/sql";
import type { DealVisibilitySession } from "@/types/session";

// Contact reads use the same owner, group, allowlist, and team rules as canSee.
// A contact has no pipeline restriction, so that column is intentionally NULL.
export function contactVisibilityClause(
  session: DealVisibilitySession,
  columns: {
    ownerId: SQL;
    visibilityLevel: SQL;
    visibilityGroupId: SQL;
    visibleToUserIds: SQL;
  },
): SQL {
  return dealVisibilityPredicate(
    {
      userId: session.userId,
      isAdmin: session.isAdmin,
      isActive: session.isActive,
      sessionLive: session.sessionLive,
      groupIds: session.visibilityGroupIds,
      managedUserIds: session.managedUserIds ?? [],
    },
    { ...columns, pipelineVisibilityGroupId: sql`NULL` },
  );
}
