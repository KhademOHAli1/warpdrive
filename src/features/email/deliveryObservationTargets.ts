import { createHash } from "node:crypto";
import { and, desc, eq, isNotNull, isNull, type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import { emailSendAttempts, emailThreads } from "@/db/schema/email";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import type { DeliveryReviewTarget } from "./deliveryObservationTypes";
import { isValidMailRecipient } from "./recipientAddress";

const address = z.string().max(254).refine(isValidMailRecipient);
const payloadSchema = z.object({
  to: z.array(address).min(1).max(1000),
  cc: z.array(address).max(1000).optional(),
  bcc: z.array(address).max(1000).optional(),
  subject: z.string().max(2000),
});

export interface DeliveryObservationTargetSnapshot {
  target: DeliveryReviewTarget;
  hash: string;
}

// JSONB's canonical text preserves all submitted payload fields, including fields omitted
// from the private picker. A changed payload/header invalidates an earlier association.
export async function readDeliveryObservationTargets(
  tx: DbOrTx,
  accountId: string,
  signal: AbortSignal,
  filter?: SQL,
  limit = 100,
): Promise<DeliveryObservationTargetSnapshot[]> {
  signal.throwIfAborted();
  const rows = await tx
    .select({
      id: emailSendAttempts.id,
      accountId: emailSendAttempts.accountId,
      messageIdHeader: emailSendAttempts.messageIdHeader,
      payload: emailSendAttempts.payload,
      payloadText: sql<string>`${emailSendAttempts.payload}::text`,
      sendStartedAt: emailSendAttempts.sendStartedAt,
      sentAt: emailSendAttempts.sentAt,
    })
    .from(emailSendAttempts)
    .innerJoin(
      emailThreads,
      and(
        eq(emailThreads.id, emailSendAttempts.threadId),
        eq(emailThreads.accountId, emailSendAttempts.accountId),
      ),
    )
    .where(
      and(
        eq(emailSendAttempts.accountId, accountId),
        eq(emailSendAttempts.payloadPrepared, true),
        isNotNull(emailSendAttempts.sendStartedAt),
        isNull(emailThreads.trashedAt),
        filter,
      ),
    )
    .orderBy(desc(emailSendAttempts.sendStartedAt), emailSendAttempts.id)
    .limit(limit)
    .for("share", { of: [emailThreads, emailSendAttempts] });
  signal.throwIfAborted();
  const snapshots: DeliveryObservationTargetSnapshot[] = [];
  for (const row of rows) {
    const payload = payloadSchema.safeParse(row.payload);
    if (!payload.success || row.sendStartedAt === null) continue;
    const recipients: DeliveryReviewTarget["recipients"] = [];
    for (const kind of ["to", "cc", "bcc"] as const) {
      for (const recipient of payload.data[kind] ?? [])
        recipients.push({ address: recipient, kind });
    }
    snapshots.push({
      target: {
        attemptId: row.id,
        subject: payload.data.subject,
        sentAt: (row.sentAt ?? row.sendStartedAt).toISOString(),
        recipients,
      },
      hash: createHash("sha256")
        .update(JSON.stringify([row.accountId, row.id, row.messageIdHeader, row.payloadText]))
        .digest("hex"),
    });
  }
  signal.throwIfAborted();
  return snapshots;
}

export async function lockDeliveryObservationAttemptScope(
  tx: DbOrTx,
  attemptId: string,
  accountId: string,
  signal: AbortSignal,
): Promise<boolean> {
  signal.throwIfAborted();
  const [attempt] = await tx
    .select({ id: emailSendAttempts.id })
    .from(emailSendAttempts)
    .innerJoin(
      emailThreads,
      and(
        eq(emailThreads.id, emailSendAttempts.threadId),
        eq(emailThreads.accountId, emailSendAttempts.accountId),
      ),
    )
    .where(
      and(
        eq(emailSendAttempts.id, attemptId),
        eq(emailSendAttempts.accountId, accountId),
        isNull(emailThreads.trashedAt),
      ),
    )
    .for("share", { of: [emailThreads, emailSendAttempts] });
  signal.throwIfAborted();
  return attempt !== undefined;
}
