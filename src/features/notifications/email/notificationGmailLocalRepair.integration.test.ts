import { sql } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { withTestDb } from "@/db/testing";
import { processSendAttempt } from "@/features/email/outbox";
import { runSendJob } from "@/features/email/worker";
import { ok } from "@/types/result";
import { runEmailNotificationJob } from "./job";
import { prepareNotificationEmail } from "./notificationBinding";
import {
  gmailNotificationCollisionFixture,
  NOTIFICATION_PROVIDER_MESSAGE_ID,
} from "./notificationCrmPrivacy.test-helpers";

it.each([
  { state: "paused", status: "connected", paused: true },
  { state: "disconnected", status: "disconnected", paused: false },
])("repairs a known Gmail notification locally with a $state mailbox", async (mailbox) => {
  await withTestDb(async (db) => {
    const signal = AbortSignal.timeout(30_000);
    const f = await gmailNotificationCollisionFixture(db, signal);
    const original = await f.originalState();
    expect(
      await prepareNotificationEmail(db, { notificationId: f.notificationId, signal }),
    ).toMatchObject({ ok: true, value: { status: "prepared" } });
    // Actual provider acceptance commits before the worker's local-copy phase.
    expect(
      await processSendAttempt(db, {
        accountId: f.account.id,
        idempotencyKey: f.notificationId,
        gmail: f.transport.gmail,
        storage: f.transport.deps.storage,
        signal,
      }),
    ).toEqual(ok({ status: "sent", gmailMessageId: NOTIFICATION_PROVIDER_MESSAGE_ID }));
    const receiptSnapshot = async () => {
      const rows = await db.execute(sql`SELECT status,gmail_message_id,provider_message_id,
        send_started_at,sent_at,delivery_outcome,payload FROM email_send_attempts
        WHERE account_id=${f.account.id} AND idempotency_key=${f.notificationId}`);
      signal.throwIfAborted();
      return rows.rows;
    };
    const receipt = await receiptSnapshot();
    expect(receipt).toMatchObject([
      {
        status: "sent",
        gmail_message_id: NOTIFICATION_PROVIDER_MESSAGE_ID,
        provider_message_id: NOTIFICATION_PROVIDER_MESSAGE_ID,
        delivery_outcome: {
          version: 1,
          provider: "gmail",
          state: "accepted",
          evidence: "api_ack",
          providerMessageId: NOTIFICATION_PROVIDER_MESSAGE_ID,
        },
      },
    ]);
    expect(await f.copy()).toEqual([]);
    expect(
      (await db.execute(sql`SELECT email_sent_at FROM notifications WHERE id=${f.notificationId}`))
        .rows,
    ).toEqual([{ email_sent_at: null }]);
    await db.execute(sql`UPDATE email_accounts
      SET status=${mailbox.status}::email_account_status,paused=${mailbox.paused},
        connection_generation=connection_generation+1
      WHERE id=${f.account.id}`);
    signal.throwIfAborted();
    const providerCalls = [...f.transport.gmail.calls];
    const resolveClient = vi.fn(f.transport.deps.resolveClient);
    const deps = { ...f.transport.deps, resolveClient };
    const args = { accountId: f.account.id, idempotencyKey: f.notificationId, signal };

    expect.soft(await runSendJob(db, args, deps)).toEqual(ok({ status: "sent" }));
    const copy = await f.copy();
    expect.soft(copy).toHaveLength(1);
    expect.soft(copy[0]).toMatchObject({
      direction: "outbound",
      gmail_message_id: NOTIFICATION_PROVIDER_MESSAGE_ID,
      provider_message_id: NOTIFICATION_PROVIDER_MESSAGE_ID,
      visibility: "private",
      person_id: null,
      deal_id: null,
    });
    expect.soft(copy[0]?.thread_id).not.toBe(f.originalThreadId);
    expect
      .soft(await runEmailNotificationJob(db, { notificationId: f.notificationId }, signal, deps))
      .toEqual(ok({ sent: true }));
    const marker = (
      await db.execute(sql`SELECT email_sent_at FROM notifications WHERE id=${f.notificationId}`)
    ).rows;
    expect.soft(marker[0]?.email_sent_at).not.toBeNull();
    expect(marker).toHaveLength(1);

    // A second receipt repair preserves the private copy's UUID/body and marker.
    expect.soft(await runSendJob(db, args, deps)).toEqual(ok({ status: "sent" }));
    expect
      .soft(await runEmailNotificationJob(db, { notificationId: f.notificationId }, signal, deps))
      .toEqual(ok({ sent: false }));
    expect.soft(await f.copy()).toEqual(copy);
    expect
      .soft(
        (
          await db.execute(
            sql`SELECT email_sent_at FROM notifications WHERE id=${f.notificationId}`,
          )
        ).rows,
      )
      .toEqual(marker);
    expect.soft(await receiptSnapshot()).toEqual(receipt);
    expect.soft(await f.originalState()).toEqual(original);
    expect.soft(resolveClient).not.toHaveBeenCalled();
    expect.soft(f.transport.gmail.calls).toEqual(providerCalls);
    expect(f.transport.gmail.raw).toHaveLength(1);
  });
});
