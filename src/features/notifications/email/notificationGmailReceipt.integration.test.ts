import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import { processSendAttempt } from "@/features/email/outbox";
import { runEmailNotificationJob } from "./job";
import { prepareNotificationEmail } from "./notificationBinding";
import {
  gmailNotificationCollisionFixture,
  NOTIFICATION_PROVIDER_MESSAGE_ID,
} from "./notificationCrmPrivacy.test-helpers";

it("records direct Gmail API acknowledgement provenance for a private notification", async () => {
  await withTestDb(async (db) => {
    const signal = AbortSignal.timeout(30_000);
    const f = await gmailNotificationCollisionFixture(db, signal);
    expect(
      await prepareNotificationEmail(db, { notificationId: f.notificationId, signal }),
    ).toMatchObject({ ok: true, value: { status: "prepared" } });
    expect(
      await processSendAttempt(db, {
        accountId: f.account.id,
        idempotencyKey: f.notificationId,
        gmail: f.transport.gmail,
        storage: f.transport.deps.storage,
        signal,
      }),
    ).toMatchObject({
      ok: true,
      value: { status: "sent", gmailMessageId: NOTIFICATION_PROVIDER_MESSAGE_ID },
    });
    const attempts = (
      await db.execute(sql`SELECT status,gmail_message_id,provider_message_id,
      send_started_at,delivery_outcome,payload FROM email_send_attempts
      WHERE account_id=${f.account.id} AND idempotency_key=${f.notificationId}`)
    ).rows;
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      status: "sent",
      gmail_message_id: NOTIFICATION_PROVIDER_MESSAGE_ID,
      provider_message_id: NOTIFICATION_PROVIDER_MESSAGE_ID,
      payload: {
        systemPurpose: { notificationId: f.notificationId, recipientUserId: f.account.userId },
      },
      delivery_outcome: {
        version: 1,
        provider: "gmail",
        state: "accepted",
        evidence: "api_ack",
        providerMessageId: NOTIFICATION_PROVIDER_MESSAGE_ID,
      },
    });
    expect(attempts[0]?.send_started_at).not.toBeNull();
    expect(f.transport.gmail.raw).toHaveLength(1);
  });
});

it("does not turn an RFC-only match into notification acceptance, a CRM association or an emailed marker", async () => {
  await withTestDb(async (db) => {
    const signal = AbortSignal.timeout(30_000);
    const f = await gmailNotificationCollisionFixture(db, signal);
    expect(
      await prepareNotificationEmail(db, { notificationId: f.notificationId, signal }),
    ).toMatchObject({ ok: true, value: { status: "prepared" } });
    const header = (
      await db.execute(sql`UPDATE email_send_attempts
      SET status='sending',send_started_at=now()
      WHERE account_id=${f.account.id} AND idempotency_key=${f.notificationId}
      RETURNING message_id_header`)
    ).rows[0]?.message_id_header;
    expect(typeof header).toBe("string");
    if (typeof header !== "string") return;
    const unrelatedId = "header-match";
    f.transport.gmail.searchHits.set(header, { messages: [{ id: unrelatedId, threadId: "t1" }] });
    f.transport.gmail.messages.set(unrelatedId, {
      id: unrelatedId,
      threadId: "t1",
      labelIds: ["SENT"],
      snippet: "Different message from an RFC search observation",
      payload: {
        mimeType: "text/html",
        body: { data: Buffer.from("<p>Different message</p>").toString("base64url") },
        headers: [
          { name: "Message-ID", value: header },
          { name: "From", value: f.account.emailAddress },
          { name: "To", value: f.account.emailAddress },
          { name: "Subject", value: "Unverified RFC observation" },
        ],
      },
    });
    await db.execute(sql`INSERT INTO email_messages
      (account_id,thread_id,gmail_message_id,provider_message_id,direction,from_email,subject,snippet,body_html)
      VALUES (${f.account.id},${f.originalThreadId},${unrelatedId},${unrelatedId},'outbound',
        ${f.account.emailAddress},'Existing unrelated mail','Original unrelated snippet','<p>Original unrelated body</p>')`);
    const before = (
      await db.execute(sql`SELECT to_jsonb(m) AS message FROM email_messages m
      WHERE m.account_id=${f.account.id} ORDER BY m.id`)
    ).rows;
    await runEmailNotificationJob(
      db,
      { notificationId: f.notificationId },
      signal,
      f.transport.deps,
    );
    const attempts = (
      await db.execute(sql`SELECT status,gmail_message_id,provider_message_id,
      send_started_at,delivery_outcome FROM email_send_attempts
      WHERE account_id=${f.account.id} AND idempotency_key=${f.notificationId}`)
    ).rows;
    expect(attempts).toHaveLength(1);
    expect
      .soft(attempts[0])
      .toMatchObject({ status: "needs_review", gmail_message_id: null, provider_message_id: null });
    expect
      .soft(attempts[0])
      .not.toMatchObject({ delivery_outcome: { state: "accepted", evidence: "api_ack" } });
    expect(attempts[0]?.send_started_at).not.toBeNull();
    expect
      .soft(
        (
          await db.execute(
            sql`SELECT email_sent_at FROM notifications WHERE id=${f.notificationId}`,
          )
        ).rows,
      )
      .toEqual([{ email_sent_at: null }]);
    expect
      .soft(
        (
          await db.execute(sql`SELECT to_jsonb(m) AS message FROM email_messages m
      WHERE m.account_id=${f.account.id} ORDER BY m.id`)
        ).rows,
      )
      .toEqual(before);
    expect(f.transport.gmail.raw).toHaveLength(0);
    expect(f.transport.gmail.calls.filter((call) => call.method === "sendRaw")).toHaveLength(0);
  });
});
