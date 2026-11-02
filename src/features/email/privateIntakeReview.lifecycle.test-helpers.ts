import { sql } from "drizzle-orm";
import { expect } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { prepareNotificationEmail } from "@/features/notifications/email/notificationBinding";
import {
  insertJobNotification,
  notificationJobTransport,
  seedNotificationDeal,
} from "@/features/notifications/email/notificationJob.test-helpers";
import { setPreference } from "@/features/notifications/preferences";
import { processSendAttempt } from "./outbox";
import { seedNativePrivateReviewMailbox } from "./privateIntakeReview.test-helpers";
import { seedPrivateIntake } from "./privateIntakeSchema.test-helpers";

export async function seedAcknowledgedPrivateReview(db: Db, signal: AbortSignal) {
  const { owner, account } = await seedNativePrivateReviewMailbox(db, signal);
  const dealId = await seedNotificationDeal(db, owner.user.id, "all", signal);
  await db.execute(sql`UPDATE email_accounts SET is_default=true WHERE id=${account.id}`);
  await setPreference(db, owner.user.id, "deal_won", { inApp: true, email: true }, signal);
  const notification = await insertJobNotification(
    db,
    {
      userId: owner.user.id,
      type: "deal_won",
      entityType: "deal",
      entityId: dealId,
      payload: {},
    },
    signal,
  );
  expect(
    await prepareNotificationEmail(db, { notificationId: notification.id, signal }),
  ).toMatchObject({
    ok: true,
    value: { status: "prepared" },
  });
  const transport = notificationJobTransport();
  expect(
    await processSendAttempt(db, {
      accountId: account.id,
      idempotencyKey: notification.id,
      gmail: transport.gmail,
      storage: transport.deps.storage,
      signal,
    }),
  ).toMatchObject({ ok: true, value: { status: "sent" } });
  expect(transport.gmail.raw).toHaveLength(1);
  const remote = transport.gmail.messages.get("sent-1");
  if (remote === undefined)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Actual private review Gmail ACK missing");
  const intake = await seedPrivateIntake(db, signal, {
    accountId: account.id,
    observedId: remote.id,
    remote,
  });
  return {
    ...intake,
    owner,
    account,
    transport,
    notificationId: notification.id,
    scope: { accountId: account.id, intakeId: intake.id },
    input: {
      accountId: account.id,
      intakeId: intake.id,
      expectedRevision: 0,
      decision: "dismiss" as const,
    },
  };
}

// This is a guarded schema transition using a real engine API ACK, not fabricated
// acceptance or an alternative promotion service. Native review must tolerate its revision gap.
export async function confirmPrivateReviewFixture(
  db: Db,
  f: Awaited<ReturnType<typeof seedAcknowledgedPrivateReview>>,
  signal: AbortSignal,
) {
  await db.transaction(
    async (tx) => {
      const confirmed = await tx.execute(sql`UPDATE email_private_intake i
      SET confirmation_attempt_id=s.id,intake_state='confirmed_notification',revision=i.revision+1,
        confirmation_snapshot=jsonb_build_object('version',1,'accountId',i.account_id::text,
          'attemptId',s.id::text,'providerMessageId',i.observed_provider_id,
          'payloadHash',public.private_intake_hash_v1(s.payload))
      FROM email_send_attempts s WHERE i.id=${f.id} AND s.account_id=i.account_id
        AND s.idempotency_key=${f.notificationId} RETURNING s.id`);
      const attemptId = confirmed.rows[0]?.id;
      if (typeof attemptId !== "string")
        throw new AppError(
          ERROR_IDS.DB_INVARIANT,
          "Private review confirmation fixture unavailable",
        );
      await tx.execute(sql`UPDATE email_threads SET provider_thread_id=${`notification:${attemptId}`}
      WHERE id=${f.threadId} AND account_id=${f.accountId}`);
      await tx.execute(sql`UPDATE email_messages SET gmail_message_id=${f.observedId},
      provider_message_id=${f.observedId},direction='outbound' WHERE id=${f.messageId}`);
      signal.throwIfAborted();
    },
    { isolationLevel: "read committed" },
  );
}
