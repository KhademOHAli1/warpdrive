import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import { parseRawMime } from "./providers/rawMime";
import { processSmtpSendAttempt } from "./smtpOutbox";
import { smtpOutboxFixture } from "./smtpOutbox.test-helpers";

for (const [locale, subject, text, filename] of [
  ["fa", "پیگیری پیشنهاد همکاری", "از همکاری شما سپاسگزاریم", "پیشنهاد.pdf"],
  ["de", "Rückfrage zum Angebot", "Grüße aus Köln", "Angebot für Sie.pdf"],
] as const)
  it(`submits ${locale} MIME once, preserves attachment names, privacy and tracking`, async () => {
    await withTestDb(async (db) => {
      const f = await smtpOutboxFixture(db);
      try {
        const bytes = Buffer.from("%PDF-1.7 synthetic");
        f.storage.objectBytes.set("synthetic-key", bytes);
        f.storage.objectsByKey.set("synthetic-key", {
          size: bytes.length,
          contentType: "application/pdf",
        });
        await f.enqueue({
          subject,
          html: `<p>${text}</p>`,
          text,
          bcc: ["secret-copy@mail.test"],
          visibility: "private",
          trackOpens: true,
          attachments: [
            {
              fileId: f.attemptId,
              s3Key: "synthetic-key",
              contentType: "application/pdf",
              filename,
            },
          ],
        });
        await db.execute(sql`INSERT INTO email_tracking_tokens (token,send_attempt_id,recipient,kind)
        VALUES (${f.attemptId},${f.attemptId},'customer@mail.test','open')`);
        const result = await processSmtpSendAttempt(db, f.args);
        expect(result).toMatchObject({
          ok: true,
          value: { status: "sent", providerMessageId: `smtp:${f.attemptId}` },
        });
        expect(f.smtp.received).toHaveLength(1);
        const raw = f.smtp.received[0];
        expect(raw).toBeDefined();
        if (raw === undefined) return;
        expect(raw.toString()).not.toContain("secret-copy@mail.test");
        const parsed = await parseRawMime({ source: raw, signal: f.args.signal });
        expect(parsed).toMatchObject({
          ok: true,
          value: { subject, attachments: [{ filename, content: bytes }] },
        });
        if (parsed.ok) expect(parsed.value.html).toContain(text);
        const artifacts = (
          await db.execute(sql`SELECT provider_locator,filename,size_bytes FROM email_message_attachments
        WHERE account_id=${f.accountId}`)
        ).rows;
        expect(artifacts).toHaveLength(1);
        expect(artifacts[0]).toMatchObject({
          filename,
          provider_locator: {
            kind: "stored",
            objectKey: expect.stringMatching(/^mail\//),
            sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          },
        });
        expect(f.storage.calls.filter((call) => call.method === "copyObject")).toHaveLength(1);
        const replay = await processSmtpSendAttempt(db, f.args);
        expect(replay).toEqual(result);
        expect(f.smtp.received).toHaveLength(1);
        const copies = (
          await db.execute(sql`SELECT m.id,m.gmail_message_id,m.rfc_message_id,m.direction,t.visibility
        FROM email_messages m JOIN email_threads t ON t.id=m.thread_id WHERE m.account_id=${f.accountId}`)
        ).rows;
        expect(copies).toHaveLength(1);
        expect(copies[0]).toMatchObject({
          gmail_message_id: null,
          direction: "outbound",
          visibility: "private",
          rfc_message_id: `<${f.attemptId}@mail.test>`,
        });
        const tokens = (
          await db.execute(
            sql`SELECT message_id FROM email_tracking_tokens WHERE send_attempt_id=${f.attemptId}`,
          )
        ).rows;
        expect(tokens[0]?.message_id).toBe(copies[0]?.id);
        expect(f.imap.state.folders.get("Sent")?.messages).toHaveLength(0);
      } finally {
        await f.close();
      }
    });
  });

it("persists partial acceptance with a CRM copy and never resubmits the rejected recipients on replay", async () => {
  await withTestDb(async (db) => {
    const f = await smtpOutboxFixture(db);
    try {
      await f.enqueue({ to: ["customer@mail.test", "reject@mail.test"] });
      const result = await processSmtpSendAttempt(db, f.args);
      expect(result).toMatchObject({
        ok: true,
        value: {
          status: "needs_review",
          messageId: expect.any(String),
          deliveryOutcome: {
            state: "partial",
            accepted: ["customer@mail.test"],
            rejected: ["reject@mail.test"],
          },
        },
      });
      await processSmtpSendAttempt(db, f.args);
      expect(f.smtp.received).toHaveLength(1);
      expect(
        (await db.execute(sql`SELECT id FROM email_messages WHERE account_id=${f.accountId}`)).rows,
      ).toHaveLength(1);
    } finally {
      await f.close();
    }
  });
});

it("keeps a lost DATA acknowledgment ambiguous and never blindly retries", async () => {
  await withTestDb(async (db) => {
    const f = await smtpOutboxFixture(db, { dropAfterData: true });
    try {
      await f.enqueue();
      expect(await processSmtpSendAttempt(db, f.args)).toMatchObject({
        ok: true,
        value: { status: "needs_review", deliveryOutcome: { state: "unknown" } },
      });
      expect(await processSmtpSendAttempt(db, f.args)).toMatchObject({
        ok: true,
        value: { status: "needs_review" },
      });
      expect(f.smtp.received).toHaveLength(1);
      expect(
        (await db.execute(sql`SELECT id FROM email_messages WHERE account_id=${f.accountId}`)).rows,
      ).toHaveLength(0);
    } finally {
      await f.close();
    }
  });
});

it("loads all attachment bytes before stamping and allows a safe corrected retry", async () => {
  await withTestDb(async (db) => {
    const f = await smtpOutboxFixture(db);
    try {
      await f.enqueue({
        attachments: [
          {
            fileId: f.attemptId,
            s3Key: "missing",
            contentType: "application/pdf",
            filename: "Angebot.pdf",
          },
        ],
      });
      expect(await processSmtpSendAttempt(db, f.args)).toMatchObject({ ok: false });
      const [attempt] = (
        await db.execute(
          sql`SELECT send_started_at,status FROM email_send_attempts WHERE id=${f.attemptId}`,
        )
      ).rows;
      expect(attempt).toMatchObject({ send_started_at: null, status: "failed" });
      expect(f.smtp.received).toHaveLength(0);
      f.storage.objectBytes.set("missing", Buffer.from("%PDF-1.7"));
      f.storage.objectsByKey.set("missing", { size: 8, contentType: "application/pdf" });
      expect(await processSmtpSendAttempt(db, f.args)).toMatchObject({
        ok: true,
        value: { status: "sent" },
      });
      expect(f.smtp.received).toHaveLength(1);
    } finally {
      await f.close();
    }
  });
});

it("checks account and snapshotted attempt generation after SMTP auth, before DATA", async () => {
  await withTestDb(async (db) => {
    const f = await smtpOutboxFixture(db);
    try {
      await f.enqueue();
      const runtime = {
        ...f.runtime,
        smtp: {
          ...f.runtime.smtp,
          sendRaw: async (args: Parameters<typeof f.runtime.smtp.sendRaw>[0]) =>
            f.runtime.smtp.sendRaw({
              ...args,
              beforeSubmission: async (signal: AbortSignal) => {
                await db.execute(
                  sql`UPDATE email_accounts SET connection_generation=2 WHERE id=${f.accountId}`,
                );
                return args.beforeSubmission?.(signal) ?? false;
              },
            }),
        },
      };
      expect(await processSmtpSendAttempt(db, { ...f.args, runtime })).toMatchObject({
        ok: false,
        error: { id: "E_MAIL_007" },
      });
      expect(f.smtp.authenticationAttempts()).toBe(1);
      expect(f.smtp.received).toHaveLength(0);
      expect(
        (
          await db.execute(
            sql`SELECT send_started_at FROM email_send_attempts WHERE id=${f.attemptId}`,
          )
        ).rows[0]?.send_started_at,
      ).toBeNull();
    } finally {
      await f.close();
    }
  });
});

it("appends only when explicitly configured and records APPENDUID on the same CRM message", async () => {
  await withTestDb(async (db) => {
    const f = await smtpOutboxFixture(db);
    try {
      f.storage.objectBytes.set("append-pdf", Buffer.from("%PDF-1.7 synthetic"));
      f.storage.objectsByKey.set("append-pdf", { size: 18, contentType: "application/pdf" });
      await f.enqueue({
        attachments: [
          {
            fileId: f.attemptId,
            s3Key: "append-pdf",
            contentType: "application/pdf",
            filename: "پیشنهاد.pdf",
          },
        ],
      });
      await db.execute(
        sql`UPDATE email_accounts SET connection_settings='{"sentCopyMode":"append","sentFolderPath":"Sent"}'::jsonb WHERE id=${f.accountId}`,
      );
      const result = await processSmtpSendAttempt(db, f.args);
      expect(result).toMatchObject({
        ok: true,
        value: { status: "sent", messageId: expect.any(String) },
      });
      await processSmtpSendAttempt(db, f.args);
      expect(f.smtp.received).toHaveLength(1);
      expect(f.imap.state.folders.get("Sent")?.messages).toHaveLength(1);
      const locators = (
        await db.execute(sql`SELECT l.message_id,l.uid_validity,l.uid,f.path FROM mail_message_locators l
        JOIN mail_folders f ON f.id=l.folder_id WHERE l.account_id=${f.accountId}`)
      ).rows;
      const attachments = (
        await db.execute(
          sql`SELECT provider_locator FROM email_message_attachments WHERE account_id=${f.accountId}`,
        )
      ).rows;
      expect(attachments).toHaveLength(1);
      expect(attachments[0]?.provider_locator).toMatchObject({ kind: "stored" });
      expect(locators).toHaveLength(1);
      if (result.ok)
        expect(locators[0]).toMatchObject({
          message_id: result.value.messageId,
          uid_validity: "456",
          uid: "1",
          path: "Sent",
        });
    } finally {
      await f.close();
    }
  });
});
