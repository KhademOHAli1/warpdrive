import { and, eq, notExists, or } from "drizzle-orm";
import type { Db } from "@/db/client";
import { agencyProjectMembers } from "@/features/agency-projects/schema/agencyProjects";
import { internalProjectItems, internalProjectSettings } from "../schema";

// Used in cross-project work queries in addition to current project membership scope.
export function projectItemVisibilityForMember(db: Db, actorId: string) {
  return or(
    eq(internalProjectItems.createdBy, actorId),
    notExists(
      db
        .select({ userId: agencyProjectMembers.userId })
        .from(agencyProjectMembers)
        .innerJoin(
          internalProjectSettings,
          eq(internalProjectSettings.projectId, agencyProjectMembers.projectId),
        )
        .where(
          and(
            eq(agencyProjectMembers.projectId, internalProjectItems.projectId),
            eq(agencyProjectMembers.userId, actorId),
            eq(agencyProjectMembers.projectGuest, true),
            eq(internalProjectSettings.guestViewAllFeatures, false),
          ),
        ),
    ),
  );
}
