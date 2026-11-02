import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { withTestDb } from "@/db/testing";
import { parseRawMime } from "./providers/rawMime";
import { sendFailureOutcome } from "./sendFailureOutcome";
import { readOwnedSendStatus } from "./sendStatus";
import { inspectSmtpSentCopy } from "./smtpMimeProof";
import { processSmtpSendAttempt } from "./smtpOutbox";
import { smtpOutboxFixture } from "./smtpOutbox.test-helpers";

it("reports an actively leased submission as pending while another caller awaits its SMTP acknowledgment", async () => {
  await withTestDb(async (db) => {
    const f = await smtpOutboxFixture(db);
    let release: (() => void) | undefined;
    let entered: (() => void) | undefined;
    let preparedRaw: Buffer | string | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const stamped = new Promise<void>((resolve) => {
      entered = resolve;
    });
    try {
      await f.enqueue();
      const runtime = {
        ...f.runtime,
        smtp: {
          ...f.runtime.smtp,
          sendRaw: async (args: Parameters<typeof f.runtime.smtp.sendRaw>[0]) => {
            preparedRaw = args.raw;
            return f.runtime.smtp.sendRaw({
              ...args,
              beforeSubmission: async (signal: AbortSignal) => {
                const allowed = await (args.beforeSubmission?.(signal) ?? false);
                entered?.();
                await gate;
                return allowed;
              },
            });
          },
        },
      };
      const first = processSmtpSendAttempt(db, { ...f.args, runtime });
      await stamped;
      if (preparedRaw !== undefined) {
        const parsed = await parseRawMime({
          source: Buffer.from(preparedRaw),
          signal: f.args.signal,
        });
        expect(parsed.ok).toBe(true);
        if (parsed.ok)
          expect(
            await inspectSmtpSentCopy(db, {
              accountId: f.accountId,
              isSentFolder: true,
              parsed: parsed.value,
              signal: f.args.signal,
            }),
          ).toEqual({ kind: "pending" });
      }
      try {
        expect(
          await readOwnedSendStatus(db, {
            actorId: f.owner.id,
            accountId: f.accountId,
            idempotencyKey: f.idempotencyKey,
            signal: f.args.signal,
          }),
        ).toMatchObject({ ok: true, value: { outcome: { status: "pending" } } });
        expect(
          await sendFailureOutcome(
            db,
            {
              attemptId: f.attemptId,
              accountId: f.accountId,
              signal: f.args.signal,
            },
            new AppError(ERROR_IDS.DB_WRITE_FAILED, "Concurrent request interrupted"),
          ),
        ).toMatchObject({
          ok: true,
          value: { status: "pending" },
        });
        expect(await processSmtpSendAttempt(db, f.args)).toEqual({
          ok: true,
          value: { status: "pending" },
        });
      } finally {
        release?.();
      }
      expect(await first).toMatchObject({ ok: true, value: { status: "sent" } });
      expect(f.smtp.received).toHaveLength(1);
    } finally {
      release?.();
      await f.close();
    }
  });
});

it("repairs a receipt committed before its CRM copy without SMTP or duplicate tracking rows", async () => {
  await withTestDb(async (db) => {
    const f = await smtpOutboxFixture(db);
    try {
      await f.enqueue();
      await db.execute(sql`UPDATE email_send_attempts SET status='sent',send_started_at=now(),sent_at=now(),
        provider_message_id=${`smtp:${f.attemptId}`},delivery_outcome='{"state":"accepted","accepted":["customer@mail.test"],"rejected":[]}'::jsonb
        WHERE id=${f.attemptId}`);
      const result = await processSmtpSendAttempt(db, f.args);
      expect(result).toMatchObject({
        ok: true,
        value: { status: "sent", messageId: expect.any(String) },
      });
      await processSmtpSendAttempt(db, f.args);
      expect(f.smtp.authenticationAttempts()).toBe(0);
      expect(
        (await db.execute(sql`SELECT id FROM email_messages WHERE account_id=${f.accountId}`)).rows,
      ).toHaveLength(1);
    } finally {
      await f.close();
    }
  });
});

for (const mutation of ["inactive_owner", "stale_attempt", "missing_generation"] as const)
  it(`refuses ${mutation} before any SMTP I/O`, async () => {
    await withTestDb(async (db) => {
      const f = await smtpOutboxFixture(db);
      try {
        await f.enqueue();
        if (mutation === "inactive_owner")
          await db.execute(sql`UPDATE users SET is_active=false WHERE id=${f.owner.id}`);
        else
          await db.execute(
            sql`UPDATE email_send_attempts SET connection_generation=${mutation === "stale_attempt" ? 2 : null} WHERE id=${f.attemptId}`,
          );
        expect(await processSmtpSendAttempt(db, f.args)).toMatchObject({
          ok: false,
          error: { id: "E_MAIL_007" },
        });
        expect(f.smtp.authenticationAttempts()).toBe(0);
        expect(f.smtp.received).toHaveLength(0);
      } finally {
        await f.close();
      }
    });
  });

it("does not append to a read-only Sent folder or resubmit its accepted message", async () => {
  await withTestDb(async (db) => {
    const f = await smtpOutboxFixture(db);
    try {
      await f.enqueue();
      await db.execute(
        sql`UPDATE email_accounts SET connection_settings='{"sentCopyMode":"append","sentFolderPath":"Sent"}'::jsonb WHERE id=${f.accountId}`,
      );
      const folder = f.imap.state.folders.get("Sent");
      if (folder !== undefined) folder.readOnly = true;
      expect(await processSmtpSendAttempt(db, f.args)).toMatchObject({
        ok: true,
        value: { status: "sent" },
      });
      await processSmtpSendAttempt(db, f.args);
      expect(f.smtp.received).toHaveLength(1);
      expect(folder?.messages).toHaveLength(0);
      expect(
        (
          await db.execute(
            sql`SELECT delivery_outcome->'sentCopy' AS sent_copy FROM email_send_attempts WHERE id=${f.attemptId}`,
          )
        ).rows[0]?.sent_copy,
      ).toMatchObject({ state: "failed", folderPath: "Sent" });
    } finally {
      await f.close();
    }
  });
});

it("releases a cancelled pre-DATA attachment preparation without waiting for the send lease", async () => {
  await withTestDb(async (db) => {
    const f = await smtpOutboxFixture(db);
    const controller = new AbortController();
    try {
      await f.enqueue({
        attachments: [
          {
            fileId: f.attemptId,
            s3Key: "cancelled",
            filename: "Angebot.pdf",
            contentType: "application/pdf",
          },
        ],
      });
      f.storage.getObjectBytes = (_key, signal) => {
        controller.abort();
        signal.throwIfAborted();
        return Promise.resolve({ ok: true, value: Buffer.from("unreachable") });
      };
      await expect(
        processSmtpSendAttempt(db, { ...f.args, signal: controller.signal }),
      ).rejects.toMatchObject({ name: "AbortError" });
      expect(
        (
          await db.execute(
            sql`SELECT status,claim_token,send_started_at FROM email_send_attempts WHERE id=${f.attemptId}`,
          )
        ).rows[0],
      ).toMatchObject({ status: "failed", claim_token: null, send_started_at: null });
      expect(f.smtp.authenticationAttempts()).toBe(0);
    } finally {
      await f.close();
    }
  });
});

it("preserves cancellation after DATA as review-required and never automatically resends", async () => {
  await withTestDb(async (db) => {
    const f = await smtpOutboxFixture(db, { stallAfterData: true });
    try {
      await f.enqueue();
      await expect(
        processSmtpSendAttempt(db, { ...f.args, signal: AbortSignal.timeout(1000) }),
      ).rejects.toMatchObject({ name: "TimeoutError" });
      expect(f.smtp.received).toHaveLength(1);
      expect(
        (
          await db.execute(
            sql`SELECT status,claim_token,send_started_at FROM email_send_attempts WHERE id=${f.attemptId}`,
          )
        ).rows[0],
      ).toMatchObject({
        status: "needs_review",
        claim_token: null,
        send_started_at: expect.anything(),
      });
      expect(await processSmtpSendAttempt(db, f.args)).toMatchObject({
        ok: true,
        value: { status: "needs_review", deliveryOutcome: { state: "unknown" } },
      });
      expect(f.smtp.received).toHaveLength(1);
    } finally {
      await f.close();
    }
  });
});
