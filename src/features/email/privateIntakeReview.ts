import { and, desc, eq } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { emailPrivateIntake, emailPrivateIntakeReviews } from "@/db/schema/emailPrivateIntake";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import { err, ok, type Result } from "@/types/result";
import { lockDeliveryObservationSession } from "./deliveryObservationAuthority";
import { lockDeliveryObservationAccount } from "./deliveryObservationScope";
import type { MailboxActorSession } from "./mailConnectionSchemas";
import type {
  PrivateIntakeReviewDecision,
  PrivateIntakeReviewError,
  PrivateIntakeReviewInput,
  PrivateIntakeReviewResult,
  PrivateIntakeSummary,
} from "./privateIntakeTypes";

interface PrivateIntakeScope {
  accountId: string;
  intakeId: string;
}

const summaryFields = {
  id: emailPrivateIntake.id,
  revision: emailPrivateIntake.revision,
  state: emailPrivateIntake.intakeState,
  contentState: emailPrivateIntake.contentState,
};

// This projection never reads the retained provider payload or private body.
async function lockPrivateIntakeScope(
  tx: DbOrTx,
  context: MailboxActorSession,
  scope: PrivateIntakeScope,
  signal: AbortSignal,
  write: boolean,
): Promise<Result<Omit<PrivateIntakeSummary, "decision">, PrivateIntakeReviewError>> {
  if (!(await lockDeliveryObservationSession(tx, context, signal))) return err("forbidden");
  if (!(await lockDeliveryObservationAccount(tx, context.actorId, scope.accountId, signal)))
    return err("not_found");
  const [row] = await tx
    .select(summaryFields)
    .from(emailPrivateIntake)
    .where(
      and(
        eq(emailPrivateIntake.id, scope.intakeId),
        eq(emailPrivateIntake.accountId, scope.accountId),
      ),
    )
    .for(write ? "no key update" : "share");
  signal.throwIfAborted();
  return row === undefined ? err("not_found") : ok(row);
}

async function latestPrivateIntakeDecision(
  tx: DbOrTx,
  scope: PrivateIntakeScope,
  signal: AbortSignal,
): Promise<PrivateIntakeReviewDecision | null> {
  const [latest] = await tx
    .select({ decision: emailPrivateIntakeReviews.decision })
    .from(emailPrivateIntakeReviews)
    .where(
      and(
        eq(emailPrivateIntakeReviews.intakeId, scope.intakeId),
        eq(emailPrivateIntakeReviews.accountId, scope.accountId),
      ),
    )
    .orderBy(desc(emailPrivateIntakeReviews.revision))
    .limit(1);
  signal.throwIfAborted();
  // Confirmation and parent purges advance the ledger independently of reviews.
  return latest?.decision ?? null;
}

async function privateIntakeTransaction(
  db: Db,
  signal: AbortSignal,
  work: (tx: DbOrTx) => Promise<PrivateIntakeReviewResult>,
): Promise<PrivateIntakeReviewResult> {
  signal.throwIfAborted();
  try {
    const result = await db.transaction(work, { isolationLevel: "read committed" });
    signal.throwIfAborted();
    return result;
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof Error && error.name === "AbortError") throw error;
    // The transaction, including any advanced revision, has rolled back first.
    return err("unavailable");
  }
}

export function readPrivateIntake(
  db: Db,
  context: MailboxActorSession,
  scope: PrivateIntakeScope,
  signal: AbortSignal,
): Promise<PrivateIntakeReviewResult> {
  return privateIntakeTransaction(db, signal, async (tx) => {
    const locked = await lockPrivateIntakeScope(tx, context, scope, signal, false);
    if (!locked.ok) return locked;
    const decision = await latestPrivateIntakeDecision(tx, scope, signal);
    return ok({ ...locked.value, decision });
  });
}

// An owner decision changes local review attention only. It cannot confirm a
// receipt, rehydrate purged content, associate an attempt or authorize a resend.
export function reviewPrivateIntake(
  db: Db,
  context: MailboxActorSession,
  args: PrivateIntakeReviewInput & { accountId: string },
  signal: AbortSignal,
): Promise<PrivateIntakeReviewResult> {
  return privateIntakeTransaction(db, signal, async (tx) => {
    const locked = await lockPrivateIntakeScope(tx, context, args, signal, true);
    if (!locked.ok) return locked;
    if (locked.value.revision !== args.expectedRevision) return err("conflict");
    const revision = args.expectedRevision + 1;
    const [updated] = await tx
      .update(emailPrivateIntake)
      .set({ revision })
      .where(
        and(
          eq(emailPrivateIntake.id, args.intakeId),
          eq(emailPrivateIntake.accountId, args.accountId),
          eq(emailPrivateIntake.revision, args.expectedRevision),
        ),
      )
      .returning(summaryFields);
    signal.throwIfAborted();
    if (updated === undefined) return err("conflict");
    const [appended] = await tx
      .insert(emailPrivateIntakeReviews)
      .values({
        intakeId: args.intakeId,
        accountId: args.accountId,
        revision,
        actorId: context.actorId,
        decision: args.decision,
      })
      .returning({ revision: emailPrivateIntakeReviews.revision });
    signal.throwIfAborted();
    if (appended === undefined)
      throw new AppError(
        ERROR_IDS.DB_INSERT_FAILED,
        "Private intake review history was not appended",
      );
    return ok({ ...updated, decision: args.decision });
  });
}
