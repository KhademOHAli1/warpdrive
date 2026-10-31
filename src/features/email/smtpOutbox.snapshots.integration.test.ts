import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { withTestDb } from "@/db/testing";
import { err } from "@/types/result";
import { processSmtpSendAttempt } from "./smtpOutbox";
import { smtpOutboxFixture } from "./smtpOutbox.test-helpers";

it("records a private snapshot destination before copy and recovers a pre-DATA copy failure safely", async () => {
  await withTestDb(async (db) => {
    const f = await smtpOutboxFixture(db);
    const copy = f.storage.copyObject.bind(f.storage);
    try {
      f.storage.objectBytes.set("original", Buffer.from("%PDF-1.7"));
      f.storage.objectsByKey.set("original", { size: 8, contentType: "application/pdf" });
      await f.enqueue({
        attachments: [
          {
            fileId: f.attemptId,
            s3Key: "original",
            filename: "پیشنهاد.pdf",
            contentType: "application/pdf",
          },
        ],
      });
      f.storage.copyObject = async (_source, _dest, signal) => {
        signal.throwIfAborted();
        const [attempt] = (
          await db.execute(
            sql`SELECT send_started_at,delivery_outcome FROM email_send_attempts WHERE id=${f.attemptId}`,
          )
        ).rows;
        expect(attempt).toMatchObject({
          send_started_at: null,
          delivery_outcome: {
            preparedAttachments: [{ objectKey: expect.stringMatching(/^mail\//), ready: false }],
          },
        });
        return err(
          new AppError(ERROR_IDS.FILE_METADATA_MISMATCH, "Synthetic private copy failure"),
        );
      };
      expect(await processSmtpSendAttempt(db, f.args)).toMatchObject({
        ok: false,
        error: { id: ERROR_IDS.FILE_METADATA_MISMATCH },
      });
      expect(f.smtp.received).toHaveLength(0);
      const before = (
        await db.execute(
          sql`SELECT delivery_outcome->'preparedAttachments'->0->>'objectKey' AS object_key FROM email_send_attempts WHERE id=${f.attemptId}`,
        )
      ).rows[0]?.object_key;
      f.storage.copyObject = copy;
      expect(await processSmtpSendAttempt(db, f.args)).toMatchObject({
        ok: true,
        value: { status: "sent" },
      });
      const after = (
        await db.execute(
          sql`SELECT delivery_outcome->'preparedAttachments'->0->>'objectKey' AS object_key FROM email_send_attempts WHERE id=${f.attemptId}`,
        )
      ).rows[0]?.object_key;
      expect(after).toBe(before);
      expect(f.smtp.received).toHaveLength(1);
      f.storage.objectBytes.delete("original");
      f.storage.objectsByKey.delete("original");
      expect(await processSmtpSendAttempt(db, f.args)).toMatchObject({
        ok: true,
        value: { status: "sent" },
      });
      expect(f.smtp.received).toHaveLength(1);
      expect(typeof after === "string" && f.storage.objectBytes.has(after)).toBe(true);
    } finally {
      await f.close();
    }
  });
});

it("does not retry SMTP or APPEND when the Sent append acknowledgment is lost", async () => {
  await withTestDb(async (db) => {
    const f = await smtpOutboxFixture(db);
    try {
      await f.enqueue();
      await db.execute(
        sql`UPDATE email_accounts SET connection_settings='{"sentCopyMode":"append","sentFolderPath":"Sent"}'::jsonb WHERE id=${f.accountId}`,
      );
      const runtime = {
        ...f.runtime,
        imap: {
          ...f.runtime.imap,
          appendSent: async (args: Parameters<typeof f.runtime.imap.appendSent>[0]) => {
            await f.runtime.imap.appendSent(args);
            return err({ kind: "mutation_unknown" as const });
          },
        },
      };
      const args = { ...f.args, runtime };
      const result = await processSmtpSendAttempt(db, args);
      expect(result).toMatchObject({
        ok: true,
        value: {
          status: "sent",
          messageId: expect.any(String),
          sentCopy: { state: "unknown", folderPath: "Sent" },
        },
      });
      expect(await processSmtpSendAttempt(db, args)).toEqual(result);
      expect(f.smtp.received).toHaveLength(1);
      expect(f.imap.state.folders.get("Sent")?.messages).toHaveLength(1);
    } finally {
      await f.close();
    }
  });
});

it("rejects a payload changed during SMTP authentication before any DATA or durable start stamp", async () => {
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
                  sql`UPDATE email_send_attempts SET payload=jsonb_set(payload,'{html}','"<p>Changed after preparation</p>"'::jsonb) WHERE id=${f.attemptId}`,
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
