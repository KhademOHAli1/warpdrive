import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { emailMessages, emailSendAttempts, emailThreads } from "@/db/schema/email";
import { emailDeliveryReports, emailDeliveryReviews } from "@/db/schema/emailDeliveryObservations";
import type { AuthUser } from "@/features/permissions/types";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import { err, ok, type Result } from "@/types/result";
import { lockDeliveryObservationReader } from "./deliveryObservationAuthority";
import { projectDeliveryObservations } from "./deliveryObservationProjection";
import {
  lockDeliveryObservationAccount,
  lockDeliveryObservationReport,
  lockDeliveryObservationSourceScope,
} from "./deliveryObservationScope";
import {
  lockDeliveryObservationAttemptScope,
  readDeliveryObservationTargets,
} from "./deliveryObservationTargets";
import type {
  DeliveryObservationError,
  DeliveryObservationView,
  DeliveryReviewTarget,
} from "./deliveryObservationTypes";

// These reads deliberately use only current mailbox ownership, never shared CRM visibility.
export async function readSourceDeliveryReports(
  db: DbOrTx,
  input: { actor: AuthUser; sourceMessageId: string },
  signal: AbortSignal,
): Promise<Result<DeliveryObservationView[], DeliveryObservationError>> {
  signal.throwIfAborted();
  if (!z.guid().safeParse(input.sourceMessageId).success) return err("invalid_input");
  const result = await db.transaction(
    async (tx): Promise<Result<DeliveryObservationView[], DeliveryObservationError>> => {
      if (
        !input.actor.isActive ||
        !(await lockDeliveryObservationReader(tx, input.actor.id, signal))
      )
        return err("not_found");
      const accountId = await lockDeliveryObservationSourceScope(
        tx,
        input.actor.id,
        input.sourceMessageId,
        signal,
      );
      if (accountId === null) return err("not_found");
      const reports = await tx
        .select()
        .from(emailDeliveryReports)
        .where(
          and(
            eq(emailDeliveryReports.accountId, accountId),
            eq(emailDeliveryReports.sourceMessageId, input.sourceMessageId),
          ),
        )
        .orderBy(emailDeliveryReports.partKey, emailDeliveryReports.id)
        .for("share");
      signal.throwIfAborted();
      return ok(await projectDeliveryObservations(tx, accountId, reports, signal));
    },
  );
  signal.throwIfAborted();
  return result;
}

export async function readAttemptDeliveryReports(
  db: DbOrTx,
  input: { actor: AuthUser; attemptId: string },
  signal: AbortSignal,
): Promise<Result<DeliveryObservationView[], DeliveryObservationError>> {
  signal.throwIfAborted();
  if (!z.guid().safeParse(input.attemptId).success) return err("invalid_input");
  const result = await db.transaction(
    async (tx): Promise<Result<DeliveryObservationView[], DeliveryObservationError>> => {
      if (
        !input.actor.isActive ||
        !(await lockDeliveryObservationReader(tx, input.actor.id, signal))
      )
        return err("not_found");
      const [identity] = await tx
        .select({ accountId: emailSendAttempts.accountId })
        .from(emailSendAttempts)
        .where(eq(emailSendAttempts.id, input.attemptId));
      signal.throwIfAborted();
      if (
        identity === undefined ||
        !(await lockDeliveryObservationAccount(tx, input.actor.id, identity.accountId, signal)) ||
        !(await lockDeliveryObservationAttemptScope(
          tx,
          input.attemptId,
          identity.accountId,
          signal,
        ))
      )
        return err("not_found");
      // History narrows the candidate sources only. The projection still selects every latest
      // recipient revision before deciding whether the requested target remains associated.
      const candidates = tx
        .select({ reportId: emailDeliveryReviews.reportId })
        .from(emailDeliveryReviews)
        .where(
          and(
            eq(emailDeliveryReviews.accountId, identity.accountId),
            eq(emailDeliveryReviews.attemptId, input.attemptId),
          ),
        );
      const rows = await tx
        .select({ report: emailDeliveryReports })
        .from(emailDeliveryReports)
        .innerJoin(
          emailMessages,
          and(
            eq(emailMessages.id, emailDeliveryReports.sourceMessageId),
            eq(emailMessages.accountId, emailDeliveryReports.accountId),
          ),
        )
        .innerJoin(
          emailThreads,
          and(
            eq(emailThreads.id, emailMessages.threadId),
            eq(emailThreads.accountId, emailMessages.accountId),
          ),
        )
        .where(
          and(
            eq(emailDeliveryReports.accountId, identity.accountId),
            inArray(emailDeliveryReports.id, candidates),
            eq(emailMessages.direction, "inbound"),
            isNull(emailThreads.trashedAt),
          ),
        )
        .orderBy(emailDeliveryReports.createdAt, emailDeliveryReports.id)
        .for("share", { of: [emailThreads, emailMessages, emailDeliveryReports] });
      signal.throwIfAborted();
      const reports = await projectDeliveryObservations(
        tx,
        identity.accountId,
        rows.map((row) => row.report),
        signal,
      );
      // An outbound view exposes only recipient blocks explicitly associated with this attempt.
      return ok(
        reports.flatMap((report) => {
          const recipients = report.recipients.filter(
            (recipient) =>
              recipient.review.decision === "associated" &&
              recipient.review.target?.attemptId === input.attemptId,
          );
          return recipients.length === 0 ? [] : [{ ...report, recipients }];
        }),
      );
    },
  );
  signal.throwIfAborted();
  return result;
}

export async function listDeliveryReviewTargets(
  db: DbOrTx,
  input: { actor: AuthUser; reportId: string },
  signal: AbortSignal,
): Promise<Result<DeliveryReviewTarget[], DeliveryObservationError>> {
  signal.throwIfAborted();
  if (!z.guid().safeParse(input.reportId).success) return err("invalid_input");
  const result = await db.transaction(
    async (tx): Promise<Result<DeliveryReviewTarget[], DeliveryObservationError>> => {
      if (
        !input.actor.isActive ||
        !(await lockDeliveryObservationReader(tx, input.actor.id, signal))
      )
        return err("not_found");
      const report = await lockDeliveryObservationReport(
        tx,
        input.actor.id,
        input.reportId,
        signal,
        false,
      );
      if (report === null) return err("not_found");
      const targets = await readDeliveryObservationTargets(tx, report.accountId, signal);
      return ok(targets.map((snapshot) => snapshot.target));
    },
  );
  signal.throwIfAborted();
  return result;
}
