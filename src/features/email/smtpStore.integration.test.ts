import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import { parseRawMime } from "./providers/rawMime";
import { findSmtpSentCopy, inspectSmtpSentCopy } from "./smtpMimeProof";
import { processSmtpSendAttempt } from "./smtpOutbox";
import { smtpOutboxFixture } from "./smtpOutbox.test-helpers";

it("adopts only a semantically proven known-accepted Sent copy, never a Message-ID or native header alone", async () => {
  await withTestDb(async (db) => {
    const f = await smtpOutboxFixture(db);
    try {
      await f.enqueue();
      const result = await processSmtpSendAttempt(db, f.args);
      expect(result.ok).toBe(true);
      const raw = f.smtp.received[0];
      if (raw === undefined || !result.ok) return;
      const parsed = await parseRawMime({
        source: Buffer.concat([Buffer.from("Received: synthetic trace\r\n"), raw]),
        signal: f.args.signal,
      });
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      const args = {
        accountId: f.accountId,
        isSentFolder: true,
        parsed: parsed.value,
        signal: f.args.signal,
      };
      expect(await findSmtpSentCopy(db, args)).toBe(result.value.messageId);
      expect(await findSmtpSentCopy(db, { ...args, isSentFolder: false })).toBeNull();
      expect(await findSmtpSentCopy(db, { ...args, accountId: randomUUID() })).toBeNull();
      expect(
        await findSmtpSentCopy(db, {
          ...args,
          parsed: { ...parsed.value, warpdriveSendAttemptId: null },
        }),
      ).toBeNull();
      expect(
        await findSmtpSentCopy(db, {
          ...args,
          parsed: { ...parsed.value, subject: "Spoofed subject" },
        }),
      ).toBeNull();
      expect(
        await findSmtpSentCopy(db, {
          ...args,
          parsed: { ...parsed.value, htmlWithRemoteImages: "<p>Changed body</p>" },
        }),
      ).toBeNull();
      expect(
        await findSmtpSentCopy(db, {
          ...args,
          parsed: { ...parsed.value, to: [{ email: "another@mail.test", name: null }] },
        }),
      ).toBeNull();
      await db.execute(
        sql`UPDATE email_send_attempts SET delivery_outcome=jsonb_set(delivery_outcome,'{state}','"unknown"'::jsonb) WHERE id=${f.attemptId}`,
      );
      expect(await findSmtpSentCopy(db, args)).toBeNull();
    } finally {
      await f.close();
    }
  });
});

it("repairs a post-acceptance CRM transaction failure without sending a second email", async () => {
  await withTestDb(async (db) => {
    const f = await smtpOutboxFixture(db);
    try {
      await f.enqueue();
      await db.execute(sql`CREATE FUNCTION synthetic_reject_copy() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'synthetic copy failure'; END $$`);
      await db.execute(
        sql`CREATE TRIGGER synthetic_reject_copy BEFORE INSERT ON email_messages FOR EACH ROW EXECUTE FUNCTION synthetic_reject_copy()`,
      );
      expect(await processSmtpSendAttempt(db, f.args)).toMatchObject({
        ok: true,
        value: {
          status: "needs_review",
          providerMessageId: `smtp:${f.attemptId}`,
          deliveryOutcome: { state: "accepted" },
        },
      });
      expect(
        (
          await db.execute(
            sql`SELECT delivery_outcome->>'state' AS state FROM email_send_attempts WHERE id=${f.attemptId}`,
          )
        ).rows[0]?.state,
      ).toBe("accepted");
      const raw = f.smtp.received[0];
      if (raw === undefined) return;
      const parsed = await parseRawMime({ source: raw, signal: f.args.signal });
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      expect(
        await inspectSmtpSentCopy(db, {
          accountId: f.accountId,
          isSentFolder: true,
          parsed: parsed.value,
          signal: f.args.signal,
        }),
      ).toEqual({ kind: "pending" });
      await db.execute(sql`DROP TRIGGER synthetic_reject_copy ON email_messages`);
      expect(await processSmtpSendAttempt(db, f.args)).toMatchObject({
        ok: true,
        value: { status: "sent", messageId: expect.any(String) },
      });
      expect(f.smtp.received).toHaveLength(1);
      expect(
        (await db.execute(sql`SELECT id FROM email_messages WHERE account_id=${f.accountId}`)).rows,
      ).toHaveLength(1);
    } finally {
      await f.close();
    }
  });
});

it("keeps replies in their mailbox/thread with RFC references and preserves thread privacy while advancing its activity", async () => {
  await withTestDb(async (db) => {
    const f = await smtpOutboxFixture(db);
    try {
      const threadId = randomUUID();
      await f.enqueue({ visibility: "private" });
      await db.execute(sql`INSERT INTO email_threads (id,account_id,provider_thread_id,subject,visibility,last_message_at)
        VALUES (${threadId},${f.accountId},'imap:original','Original subject','shared','2020-01-01T00:00Z')`);
      await db.execute(sql`INSERT INTO email_messages
        (account_id,thread_id,provider_message_id,rfc_message_id,"references",direction,from_email,to_emails,sent_at)
        VALUES (${f.accountId},${threadId},'imap:parent','<parent@mail.test>',ARRAY['<start@mail.test>'],'inbound','customer@mail.test','["owner@mail.test"]'::jsonb,'2020-01-01T00:00Z')`);
      await db.execute(
        sql`UPDATE email_send_attempts SET thread_id=${threadId} WHERE id=${f.attemptId}`,
      );
      const result = await processSmtpSendAttempt(db, f.args);
      expect(result).toMatchObject({ ok: true, value: { status: "sent" } });
      const raw = f.smtp.received[0];
      if (raw === undefined) return;
      const parsed = await parseRawMime({ source: raw, signal: f.args.signal });
      expect(parsed).toMatchObject({
        ok: true,
        value: {
          inReplyTo: "<parent@mail.test>",
          references: ["<start@mail.test>", "<parent@mail.test>"],
        },
      });
      const [thread] = (
        await db.execute(
          sql`SELECT visibility,subject,last_message_at FROM email_threads WHERE id=${threadId}`,
        )
      ).rows as { visibility: string; subject: string; last_message_at: Date }[];
      expect(thread).toMatchObject({ visibility: "shared", subject: "Original subject" });
      expect(new Date(thread?.last_message_at ?? "").getTime()).toBeGreaterThan(
        new Date("2020-01-01T00:00Z").getTime(),
      );
      expect(
        (await db.execute(sql`SELECT id FROM email_threads WHERE account_id=${f.accountId}`)).rows,
      ).toHaveLength(1);
    } finally {
      await f.close();
    }
  });
});
