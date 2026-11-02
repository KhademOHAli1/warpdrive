import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import { FakeStorageClient } from "@/features/files/storageFake";
import { ok } from "@/types/result";
import { FakeGmailClient } from "./gmailFake";
import { enqueueSend } from "./outbox";
import { sendEmail } from "./send";
import { smtpOutboxFixture } from "./smtpOutbox.test-helpers";

it("recovers an unprepared independent send using the original snapshot rather than changed retry input", async () => {
  await withTestDb(async (db) => {
    const f = await smtpOutboxFixture(db);
    try {
      const key = randomUUID();
      await enqueueSend(db, {
        accountId: f.accountId,
        idempotencyKey: key,
        requiresPreparation: true,
        payload: { to: ["customer@mail.test"], subject: "Original", html: "<p>اصل پیام</p>" },
      });
      const result = await sendEmail(db, {
        actorId: f.owner.id,
        actorType: "regular",
        actorGroupIds: new Set(),
        mail: f.runtime,
        storage: f.storage,
        signal: f.args.signal,
        input: {
          accountId: f.accountId,
          idempotencyKey: key,
          to: ["changed@mail.test"],
          subject: "Changed",
          bodyHtml: "<p>Changed</p>",
          attachments: [{ fileId: randomUUID() }],
        },
      });
      expect(result.ok && result.value.status).toBe("sent");
      expect(f.smtp.received).toHaveLength(1);
      const row = (
        await db.execute(
          sql`SELECT subject,body_html,to_emails FROM email_messages WHERE account_id=${f.accountId}`,
        )
      ).rows[0];
      expect(row).toMatchObject({ subject: "Original", to_emails: ["customer@mail.test"] });
      expect(row?.body_html).toContain("اصل پیام");
    } finally {
      await f.close();
    }
  });
});

it("retains a known Gmail acceptance when local-copy persistence fails and repairs from the saved snapshot", async () => {
  await withTestDb(async (db) => {
    const f = await smtpOutboxFixture(db);
    try {
      await db.execute(sql`UPDATE email_accounts SET provider='gmail' WHERE id=${f.accountId}`);
      const gmail = new FakeGmailClient();
      gmail.sendImpl = () => ok({ id: "google-accepted", threadId: "google-thread" });
      gmail.messages.set("google-accepted", {
        id: "google-accepted",
        threadId: "google-thread",
        labelIds: [],
      });
      await db.execute(
        sql`CREATE FUNCTION fail_send_copy() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'synthetic local-copy failure'; END$$`,
      );
      await db.execute(
        sql`CREATE TRIGGER fail_send_copy BEFORE INSERT ON email_messages FOR EACH ROW EXECUTE FUNCTION fail_send_copy()`,
      );
      const args = {
        actorId: f.owner.id,
        actorType: "regular" as const,
        actorGroupIds: new Set<string>(),
        gmail,
        storage: new FakeStorageClient(),
        signal: f.args.signal,
        input: {
          accountId: f.accountId,
          idempotencyKey: f.idempotencyKey,
          to: ["customer@mail.test"],
          subject: "Original",
          bodyHtml: "<p>پیشنهاد</p>",
        },
      };
      const accepted = await sendEmail(db, args);
      expect(accepted).toMatchObject({
        ok: true,
        value: {
          status: "needs_review",
          deliveryOutcome: { state: "accepted" },
          providerMessageId: "google-accepted",
        },
      });
      await db.execute(sql`DROP TRIGGER fail_send_copy ON email_messages`);
      const repaired = await sendEmail(db, {
        ...args,
        input: { ...args.input, subject: "Changed", attachments: [{ fileId: randomUUID() }] },
      });
      expect(repaired.ok && repaired.value.status).toBe("sent");
      expect(gmail.calls.filter((call) => call.method === "sendRaw")).toHaveLength(1);
      expect(
        (await db.execute(sql`SELECT subject FROM email_messages WHERE account_id=${f.accountId}`))
          .rows[0],
      ).toMatchObject({ subject: "Original" });
    } finally {
      await f.close();
    }
  });
});
