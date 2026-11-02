import { and, eq, notExists, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { privacyCaseEvents, privacyCaseMembers, privacyCases } from "@/db/schema";

// Intake membership alone must not strand a case or grant access to matched subject data.
function hasReviewAssignment(db: Db) {
  return db
    .select({ userId: privacyCaseMembers.userId })
    .from(privacyCaseMembers)
    .where(
      and(
        eq(privacyCaseMembers.caseId, privacyCases.id),
        sql`jsonb_path_exists(${privacyCaseMembers.capabilities}, '$[*] ? (@ != "case.intake")')`,
      ),
    );
}

export function unassignedIntakeCondition(db: Db) {
  return and(
    notExists(hasReviewAssignment(db)),
    notExists(
      db
        .select({ id: privacyCaseEvents.id })
        .from(privacyCaseEvents)
        .where(
          and(
            eq(privacyCaseEvents.caseId, privacyCases.id),
            eq(privacyCaseEvents.action, "case.assigned"),
          ),
        ),
    ),
  );
}
