import { and, eq, isNull } from "drizzle-orm";
import { emailAccounts, emailMessages, emailThreads } from "@/db/schema/email";
import {
  type EmailDeliveryReportRow,
  emailDeliveryReports,
} from "@/db/schema/emailDeliveryObservations";
import type { DbOrTx } from "@/server/realtime/channelVersions";

export async function lockDeliveryObservationAccount(
  tx: DbOrTx,
  actorId: string,
  accountId: string,
  signal: AbortSignal,
): Promise<boolean> {
  signal.throwIfAborted();
  const [account] = await tx
    .select({ id: emailAccounts.id })
    .from(emailAccounts)
    .where(and(eq(emailAccounts.id, accountId), eq(emailAccounts.userId, actorId)))
    .for("share");
  signal.throwIfAborted();
  return account !== undefined;
}

// Lock parents before their evidence so source/account privacy purges keep their order.
export async function lockDeliveryObservationSourceScope(
  tx: DbOrTx,
  actorId: string,
  sourceMessageId: string,
  signal: AbortSignal,
): Promise<string | null> {
  signal.throwIfAborted();
  const [identity] = await tx
    .select({ accountId: emailMessages.accountId })
    .from(emailMessages)
    .where(eq(emailMessages.id, sourceMessageId));
  signal.throwIfAborted();
  if (
    identity === undefined ||
    !(await lockDeliveryObservationAccount(tx, actorId, identity.accountId, signal))
  )
    return null;
  const [source] = await tx
    .select({ accountId: emailMessages.accountId })
    .from(emailMessages)
    .innerJoin(
      emailThreads,
      and(
        eq(emailThreads.id, emailMessages.threadId),
        eq(emailThreads.accountId, emailMessages.accountId),
      ),
    )
    .where(
      and(
        eq(emailMessages.id, sourceMessageId),
        eq(emailMessages.accountId, identity.accountId),
        eq(emailMessages.direction, "inbound"),
        isNull(emailThreads.trashedAt),
      ),
    )
    .for("share", { of: [emailThreads, emailMessages] });
  signal.throwIfAborted();
  return source?.accountId ?? null;
}

export async function lockDeliveryObservationReport(
  tx: DbOrTx,
  actorId: string,
  reportId: string,
  signal: AbortSignal,
  write: boolean,
): Promise<EmailDeliveryReportRow | null> {
  signal.throwIfAborted();
  const [identity] = await tx
    .select({ sourceMessageId: emailDeliveryReports.sourceMessageId })
    .from(emailDeliveryReports)
    .where(eq(emailDeliveryReports.id, reportId));
  signal.throwIfAborted();
  if (identity === undefined) return null;
  const accountId = await lockDeliveryObservationSourceScope(
    tx,
    actorId,
    identity.sourceMessageId,
    signal,
  );
  if (accountId === null) return null;
  const [report] = await tx
    .select()
    .from(emailDeliveryReports)
    .where(
      and(
        eq(emailDeliveryReports.id, reportId),
        eq(emailDeliveryReports.accountId, accountId),
        eq(emailDeliveryReports.sourceMessageId, identity.sourceMessageId),
      ),
    )
    .for(write ? "no key update" : "share");
  signal.throwIfAborted();
  return report ?? null;
}
