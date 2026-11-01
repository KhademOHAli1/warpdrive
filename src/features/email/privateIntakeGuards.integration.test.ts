import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
import { preparedGmailIntakeFixture } from "@/features/notifications/email/notificationCrmPrivacy.preReceipt.test-helpers";
import { NOTIFICATION_PROVIDER_MESSAGE_ID } from "@/features/notifications/email/notificationCrmPrivacy.test-helpers";
import {
  appendPrivateIntakeSchemaReview,
  expectPrivateIntakePgError,
  privateIntakeRow,
  seedPrivateIntake,
} from "./privateIntakeSchema.test-helpers";

it.each(["membership", "claimed_identity", "payload_hash", "baseline_hash"] as const)(
  "rejects a private intake with invalid %s despite otherwise valid canonical fixtures",
  async (kind) => {
    await withTestDb(async (db) => {
      const signal = AbortSignal.timeout(30_000);
      await expectPrivateIntakePgError(
        seedPrivateIntake(db, signal, {
          observedPayloadHashOverride: kind === "payload_hash" ? "0".repeat(64) : undefined,
          baselineMessageHashOverride: kind === "baseline_hash" ? "0".repeat(64) : undefined,
          beforeLedger: async (tx, copy) => {
            if (kind === "membership")
              await tx.execute(sql`INSERT INTO email_messages
              (account_id,thread_id,provider_message_id,direction,from_email,body_text)
              VALUES(${copy.accountId},${copy.threadId},${`ordinary:${randomUUID()}`},
                'inbound','customer@example.test','Independent user message')`);
            if (kind === "claimed_identity")
              await tx.execute(sql`UPDATE email_messages SET gmail_message_id='claimed-before-proof'
              WHERE id=${copy.messageId}`);
          },
        }),
        ["23514"],
        signal,
      );
      expect((await db.execute(sql`SELECT id FROM email_private_intake`)).rows).toEqual([]);
    });
  },
);

it("rejects an observed payload naming another actual provider ID", async () => {
  await withTestDb(async (db) => {
    const signal = AbortSignal.timeout(30_000);
    await expectPrivateIntakePgError(
      seedPrivateIntake(db, signal, {
        observedId: "expected-provider-id",
        remote: {
          id: "different-provider-id",
          threadId: "remote",
          labelIds: [],
          payload: {
            headers: [{ name: "From", value: "sender@example.test" }],
            mimeType: "text/plain",
            body: { data: Buffer.from("Private content").toString("base64url") },
          },
        },
      }),
      ["23514"],
      signal,
    );
  });
});

it("rejects a valid-shaped confirmation without an actual canonical Gmail API ACK", async () => {
  await withTestDb(async (db) => {
    const signal = AbortSignal.timeout(30_000);
    const notification = await preparedGmailIntakeFixture(db, signal, "fa");
    const f = await seedPrivateIntake(db, signal, {
      accountId: notification.account.id,
      observedId: NOTIFICATION_PROVIDER_MESSAGE_ID,
    });
    const before = await privateIntakeRow(db, f.id, signal);
    await expectPrivateIntakePgError(
      db.execute(sql`UPDATE email_private_intake i
      SET confirmation_attempt_id=s.id,intake_state='confirmed_notification',revision=i.revision+1,
        confirmation_snapshot=jsonb_build_object('version',1,'accountId',i.account_id::text,
          'attemptId',s.id::text,'providerMessageId',i.observed_provider_id,
          'payloadHash',public.private_intake_hash_v1(s.payload))
      FROM email_send_attempts s WHERE i.id=${f.id} AND s.account_id=i.account_id
        AND s.idempotency_key=${notification.notificationId}`),
      ["23514"],
      signal,
    );
    expect(await privateIntakeRow(db, f.id, signal)).toEqual(before);
    expect(notification.transport.gmail.raw).toHaveLength(0);
  });
});

it("retains real ACK confirmation and prior disposition when its attempt parent is purged", async () => {
  await withTestDb(async (db) => {
    const signal = AbortSignal.timeout(30_000);
    const notification = await preparedGmailIntakeFixture(db, signal, "de");
    expect(await notification.send()).toMatchObject({ ok: true, value: { status: "sent" } });
    const remote = notification.transport.gmail.messages.get(NOTIFICATION_PROVIDER_MESSAGE_ID);
    if (remote === undefined)
      throw new AppError(ERROR_IDS.DB_INVARIANT, "Canonical Gmail fixture message missing");
    const f = await seedPrivateIntake(db, signal, {
      accountId: notification.account.id,
      observedId: remote.id,
      remote,
    });
    await appendPrivateIntakeSchemaReview(db, {
      intakeId: f.id,
      accountId: f.accountId,
      actorId: f.ownerId,
      expectedRevision: 0,
      decision: "dismiss",
      signal,
    });
    await db.transaction(async (tx) => {
      const confirmed = await tx.execute(sql`UPDATE email_private_intake i
        SET confirmation_attempt_id=s.id,intake_state='confirmed_notification',revision=i.revision+1,
          confirmation_snapshot=jsonb_build_object('version',1,'accountId',i.account_id::text,
            'attemptId',s.id::text,'providerMessageId',i.observed_provider_id,
            'payloadHash',public.private_intake_hash_v1(s.payload))
        FROM email_send_attempts s WHERE i.id=${f.id} AND s.account_id=i.account_id
          AND s.idempotency_key=${notification.notificationId} RETURNING s.id`);
      const attemptId = confirmed.rows[0]?.id;
      if (typeof attemptId !== "string")
        throw new AppError(ERROR_IDS.DB_INVARIANT, "Canonical confirmation fixture unavailable");
      await tx.execute(sql`UPDATE email_threads SET provider_thread_id=${`notification:${attemptId}`}
        WHERE id=${f.threadId} AND account_id=${f.accountId}`);
      await tx.execute(sql`UPDATE email_messages SET gmail_message_id=${remote.id},
        provider_message_id=${remote.id},direction='outbound' WHERE id=${f.messageId}`);
      signal.throwIfAborted();
    });
    const before = await privateIntakeRow(db, f.id, signal);
    expect(before).toMatchObject({
      revision: 2,
      intake_state: "confirmed_notification",
      owned_message_id: f.messageId,
      confirmation_snapshot: { providerMessageId: remote.id },
    });
    await db.execute(sql`DELETE FROM email_send_attempts WHERE account_id=${f.accountId}
      AND idempotency_key=${notification.notificationId}`);
    signal.throwIfAborted();
    expect(await privateIntakeRow(db, f.id, signal)).toEqual({
      ...before,
      confirmation_attempt_id: null,
      revision: 3,
    });
    expect(
      (
        await db.execute(sql`SELECT revision,decision FROM email_private_intake_reviews
      WHERE intake_id=${f.id} ORDER BY revision`)
      ).rows,
    ).toEqual([{ revision: 1, decision: "dismiss" }]);
    expect(notification.transport.gmail.raw).toHaveLength(1);
  });
});

it("allows real actor cleanup and account cascade without weakening immutable history", async () => {
  await withTestDb(async (db) => {
    const signal = AbortSignal.timeout(30_000);
    const f = await seedPrivateIntake(db, signal);
    await appendPrivateIntakeSchemaReview(db, {
      intakeId: f.id,
      accountId: f.accountId,
      actorId: f.ownerId,
      expectedRevision: 0,
      decision: "keep_private",
      signal,
    });
    const replacement = await seedUser(db);
    // A historical actor can be removed after the mailbox has another owner.
    // This is a schema fixture, not authorization to transfer a real mailbox.
    await db.execute(
      sql`UPDATE email_accounts SET user_id=${replacement.id} WHERE id=${f.accountId}`,
    );
    await db.execute(sql`DELETE FROM users WHERE id=${f.ownerId}`);
    signal.throwIfAborted();
    expect(
      (
        await db.execute(sql`SELECT actor_id,decision,revision FROM email_private_intake_reviews
      WHERE intake_id=${f.id}`)
      ).rows,
    ).toEqual([{ actor_id: null, decision: "keep_private", revision: 1 }]);
    await db.execute(sql`DELETE FROM email_messages WHERE id=${f.messageId}`);
    await db.execute(sql`DELETE FROM email_threads WHERE id=${f.threadId}`);
    await db.execute(sql`DELETE FROM email_accounts WHERE id=${f.accountId}`);
    signal.throwIfAborted();
    expect(
      (await db.execute(sql`SELECT id FROM email_private_intake WHERE id=${f.id}`)).rows,
    ).toEqual([]);
    expect(
      (
        await db.execute(sql`SELECT intake_id FROM email_private_intake_reviews
      WHERE intake_id=${f.id}`)
      ).rows,
    ).toEqual([]);
  });
});
