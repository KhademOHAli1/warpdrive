import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import {
  deliveryMachinePart,
  deliverySignal,
  reportedRecipient,
  seedDeliveryFixture,
} from "./deliveryObservation.test-helpers";
import { ingestDeliveryReports } from "./deliveryObservationIngest";
import { reviewDeliveryReport } from "./deliveryObservationReview";
import { storeNotificationGmailCopy } from "./notificationGmailCopy";

type MessageRefFixture = Awaited<ReturnType<typeof seedDeliveryFixture>> & {
  providerId: string;
  reportId: string | null;
};

export async function seedMessageRefFixture(
  db: Db,
  provider: "imap_smtp" | "gmail" = "imap_smtp",
  evidence: "none" | "observed" | "associated" = "associated",
): Promise<MessageRefFixture> {
  const f = await seedDeliveryFixture(db);
  const providerId = provider === "imap_smtp" ? `smtp:${f.attempt.attemptId}` : "18fe390a7b01";
  const gmailId = provider === "gmail" ? providerId : null;
  await db.execute(sql`UPDATE email_accounts SET provider=${provider} WHERE id=${f.accountId}`);
  await db.execute(sql`UPDATE email_messages SET provider_message_id=${providerId},
    gmail_message_id=${gmailId},tracking_enabled=false WHERE id=${f.attempt.messageId}`);
  await db.execute(sql`UPDATE email_send_attempts SET provider_message_id=${providerId},
    gmail_message_id=${gmailId} WHERE id=${f.attempt.attemptId}`);
  let reportId: string | null = null;
  if (evidence !== "none") {
    const ingested = await ingestDeliveryReports(
      db,
      {
        accountId: f.accountId,
        sourceMessageId: f.source.messageId,
        parts: [deliveryMachinePart()],
      },
      deliverySignal(),
    );
    if (!ingested.ok || ingested.value.reportIds[0] === undefined)
      throw new AppError(ERROR_IDS.DB_INVARIANT, "Missing reader report fixture");
    reportId = ingested.value.reportIds[0];
  }
  const fixture = { ...f, providerId, reportId };
  if (evidence === "associated") await addMessageRefReview(db, fixture);
  return fixture;
}

export async function addMessageRefReview(
  db: Db,
  f: MessageRefFixture,
  expectedRevision = 0,
  targetId = f.attempt.attemptId,
  decision: "associate" | "dismiss" = "associate",
) {
  if (f.reportId === null)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Missing review source fixture");
  const base = {
    reportId: f.reportId,
    recipientIndex: 0,
    expectedRevision,
    confirmUnverified: true,
  };
  const input =
    decision === "dismiss"
      ? { ...base, decision }
      : { ...base, decision, target: { attemptId: targetId, recipient: reportedRecipient } };
  const reviewed = await reviewDeliveryReport(db, f.owner.context, input, deliverySignal());
  if (!reviewed.ok)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Reader review fixture failed", {
      error: reviewed.error,
    });
}

export async function shareMessageRefThreads(
  db: Db,
  f: Awaited<ReturnType<typeof seedMessageRefFixture>>,
) {
  const person = (
    await db.execute(sql`INSERT INTO persons(name,owner_id,visibility_level)
    VALUES('Shared reader contact',${f.actor.id},'all') RETURNING id`)
  ).rows[0];
  if (person === undefined || typeof person.id !== "string")
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Missing shared reader fixture contact");
  await db.execute(sql`UPDATE email_threads SET visibility='shared',person_id=${person.id}
    WHERE id IN (${f.source.threadId},${f.attempt.threadId})`);
}

// Match the persisted private notification copy, including its intentionally detached attempt.
export async function seedCanonicalNotificationMessageRef(db: Db) {
  const f = await seedMessageRefFixture(db, "gmail", "observed");
  const notificationId = randomUUID();
  const threadId = randomUUID();
  const payload = {
    ...f.attempt.payload,
    systemPurpose: {
      version: 1,
      kind: "notification",
      notificationId,
      recipientUserId: f.actor.id,
    },
  };
  const receipt = {
    version: 1,
    provider: "gmail",
    state: "accepted",
    evidence: "api_ack",
    providerMessageId: f.providerId,
  };
  await db.execute(sql`INSERT INTO email_threads
    (id,account_id,provider_thread_id,subject,visibility)
    VALUES(${threadId},${f.accountId},${`notification:${f.attempt.attemptId}`},
      ${f.attempt.payload.subject},'private')`);
  await db.execute(sql`UPDATE email_send_attempts SET
    idempotency_key=${notificationId},payload=${JSON.stringify(payload)}::jsonb,
    delivery_outcome=${JSON.stringify(receipt)}::jsonb WHERE id=${f.attempt.attemptId}`);
  // Review the final immutable payload while the ordinary target scope is still available.
  // Canonical receipt isolation later detaches the attempt without changing that snapshot.
  await addMessageRefReview(db, f);
  await db.execute(
    sql`UPDATE email_send_attempts SET thread_id=NULL WHERE id=${f.attempt.attemptId}`,
  );
  await db.execute(sql`UPDATE email_messages SET thread_id=${threadId}
    WHERE id=${f.attempt.messageId}`);
  await db.execute(sql`UPDATE email_accounts SET capabilities=
    '{"read":true,"send":false,"markRead":false,"move":false,"trash":false}'::jsonb
    WHERE id=${f.accountId}`);
  const copied = await storeNotificationGmailCopy(db, {
    accountId: f.accountId,
    idempotencyKey: notificationId,
    gmailMessageId: f.providerId,
    signal: deliverySignal(),
  });
  if (!copied.ok)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Canonical reader copy fixture failed");
  return { ...f, canonicalThreadId: threadId };
}
