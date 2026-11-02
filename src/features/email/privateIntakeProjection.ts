import { and, asc, desc, eq, exists, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { emailAccounts } from "@/db/schema/email";
import { emailPrivateIntake, emailPrivateIntakeReviews } from "@/db/schema/emailPrivateIntake";
import type { AuthUser } from "@/features/permissions/types";
import { lockDeliveryObservationReader } from "./deliveryObservationAuthority";
import type { PrivateIntakeSummary } from "./privateIntakeTypes";

interface ProjectionInput {
  actor: AuthUser;
  threadIds: readonly string[];
  messageIds: readonly string[];
}

interface PrivateIntakeProjection {
  threads: ReadonlyMap<string, PrivateIntakeSummary>;
  messages: ReadonlyMap<string, PrivateIntakeSummary>;
}

// A batched owner-only hint for already-authorized reader DTOs. This does not
// replace the native full-session review boundary or authorize mail actions.
export async function readPrivateIntakeProjection(
  db: Db,
  input: ProjectionInput,
  signal: AbortSignal,
): Promise<PrivateIntakeProjection> {
  signal.throwIfAborted();
  const threads = new Map<string, PrivateIntakeSummary>();
  const messages = new Map<string, PrivateIntakeSummary>();
  const threadIds = new Set(input.threadIds);
  const messageIds = new Set(input.messageIds);
  if (!input.actor.isActive || (threadIds.size === 0 && messageIds.size === 0))
    return { threads, messages };
  const target = sql`(
    ${threadIds.size === 0 ? sql`false` : inArray(emailPrivateIntake.baselineThreadId, [...threadIds])}
    OR ${messageIds.size === 0 ? sql`false` : inArray(emailPrivateIntake.ownedMessageId, [...messageIds])}
  )`;
  await db.transaction(
    async (tx) => {
      if (!(await lockDeliveryObservationReader(tx, input.actor.id, signal))) return;
      // Lock current owner accounts before their evidence, matching parent purge order.
      const accounts = await tx
        .select({ id: emailAccounts.id })
        .from(emailAccounts)
        .where(
          and(
            eq(emailAccounts.userId, input.actor.id),
            exists(
              tx
                .select({ id: emailPrivateIntake.id })
                .from(emailPrivateIntake)
                .where(and(eq(emailPrivateIntake.accountId, emailAccounts.id), target)),
            ),
          ),
        )
        .orderBy(asc(emailAccounts.id))
        .for("share");
      signal.throwIfAborted();
      if (accounts.length === 0) return;
      const rows = await tx
        .select({
          id: emailPrivateIntake.id,
          revision: emailPrivateIntake.revision,
          state: emailPrivateIntake.intakeState,
          contentState: emailPrivateIntake.contentState,
          threadId: emailPrivateIntake.baselineThreadId,
          messageId: emailPrivateIntake.ownedMessageId,
        })
        .from(emailPrivateIntake)
        .where(
          and(
            inArray(
              emailPrivateIntake.accountId,
              accounts.map((account) => account.id),
            ),
            target,
          ),
        )
        .for("share");
      signal.throwIfAborted();
      if (rows.length === 0) return;
      // Read history after all ledger locks have been acquired. A fresh RC statement
      // also sees a review that committed while the ledger lock was being awaited.
      const reviews = await tx
        .selectDistinctOn([emailPrivateIntakeReviews.intakeId], {
          intakeId: emailPrivateIntakeReviews.intakeId,
          decision: emailPrivateIntakeReviews.decision,
        })
        .from(emailPrivateIntakeReviews)
        .where(
          and(
            inArray(
              emailPrivateIntakeReviews.accountId,
              accounts.map((account) => account.id),
            ),
            inArray(
              emailPrivateIntakeReviews.intakeId,
              rows.map((row) => row.id),
            ),
          ),
        )
        .orderBy(asc(emailPrivateIntakeReviews.intakeId), desc(emailPrivateIntakeReviews.revision));
      signal.throwIfAborted();
      const decisions = new Map(reviews.map((review) => [review.intakeId, review.decision]));
      for (const row of rows) {
        const summary: PrivateIntakeSummary = {
          id: row.id,
          revision: row.revision,
          state: row.state,
          contentState: row.contentState,
          decision: decisions.get(row.id) ?? null,
        };
        if (threadIds.has(row.threadId)) threads.set(row.threadId, summary);
        if (row.messageId !== null && messageIds.has(row.messageId))
          messages.set(row.messageId, summary);
      }
    },
    { isolationLevel: "read committed" },
  );
  signal.throwIfAborted();
  return { threads, messages };
}
