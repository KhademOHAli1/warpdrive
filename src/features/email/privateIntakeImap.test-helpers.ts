import { sql } from "drizzle-orm";
import { expect } from "vitest";
import { z } from "zod";
import type { Db } from "@/db/client";
import {
  enqueueRetainedNotification,
  notificationAttempts,
  notificationSmtpFixture,
} from "@/features/notifications/email/notificationDispatch.test-helpers";
import { ok } from "@/types/result";
import { deliveryMachinePart } from "./deliveryObservation.test-helpers";
import { runImapSyncJob } from "./imapSync";
import { IMAP_SYNC_NOW } from "./imapSync.test-helpers";
import { runSendJob } from "./worker";

const identitySchema = z.strictObject({
  intake_id: z.guid(),
  message_id: z.guid(),
  thread_id: z.guid(),
  folder_id: z.guid(),
});

// Reuse the bounded machine fixture with the established native multipart/report envelope.
export function heldDeliveryReportSource(): Buffer {
  const machine = deliveryMachinePart();
  return Buffer.from(
    [
      "From: mailer-daemon@example.test",
      "To: owner@mail.test",
      "Subject: Changed held delivery report",
      "Message-ID: <changed-held-dsn@example.test>",
      "MIME-Version: 1.0",
      'Content-Type: multipart/report; report-type=global-delivery-status; boundary="held-dsn"',
      "",
      "--held-dsn",
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from("گزارش دریافت‌شده / Empfangener Bericht").toString("base64"),
      "--held-dsn",
      "Content-Type: message/global-delivery-status",
      "Content-Transfer-Encoding: base64",
      "",
      machine.content.toString("base64"),
      "--held-dsn--",
      "",
    ].join("\r\n"),
  );
}

interface HeldSelfDeliveryFixture {
  identity: z.infer<typeof identitySchema>;
  accountId: string;
  source: Buffer;
  snapshot: () => Promise<unknown>;
  attempts: () => Promise<unknown>;
  canonical: () => Promise<unknown>;
  locatorFingerprint: () => Promise<string>;
  replay: (source: Buffer) => Promise<Awaited<ReturnType<typeof runImapSyncJob>>>;
  appendOrdinary: (source: Buffer) => Promise<Awaited<ReturnType<typeof runImapSyncJob>>>;
  sendCount: () => number;
  signal: AbortSignal;
}

export async function withHeldSelfDelivery(
  db: Db,
  run: (fixture: HeldSelfDeliveryFixture) => Promise<void>,
) {
  const f = await notificationSmtpFixture(db);
  try {
    const signal = f.args.signal;
    expect(await enqueueRetainedNotification(db, f)).toMatchObject({ ok: true });
    expect(
      await runSendJob(
        db,
        {
          accountId: f.accountId,
          idempotencyKey: f.notificationId,
          signal,
        },
        f.deps,
      ),
    ).toMatchObject({ ok: true, value: { status: "sent" } });
    expect(f.smtp.received).toHaveLength(1);
    const raw = f.smtp.received[0];
    const inbox = f.imap.state.folders.get("INBOX");
    expect(raw).toBeDefined();
    expect(inbox).toBeDefined();
    if (raw === undefined || inbox === undefined) return;
    const source = Buffer.concat([Buffer.from("Received: by private-intake.mail.test\r\n"), raw]);
    inbox.messages = [{ uid: 1, flags: [], date: IMAP_SYNC_NOW, source }];
    f.runtime.folderPaths = ["INBOX"];
    const sync = () =>
      runImapSyncJob(
        db,
        { accountId: f.accountId, signal, now: IMAP_SYNC_NOW },
        { loadConnection: () => Promise.resolve(ok(f.runtime)) },
      );
    expect(await sync()).toMatchObject({ ok: true, value: { applied: 1, stale: false } });
    const ids = await db.execute(sql`SELECT i.id AS intake_id,i.owned_message_id AS message_id,
      i.baseline_thread_id AS thread_id,folder.id AS folder_id
      FROM email_private_intake i JOIN mail_folders folder ON folder.account_id=i.account_id
      WHERE i.account_id=${f.accountId} AND i.provider='imap_smtp' AND folder.path='INBOX'
        AND i.observed_provider_id='imap:'||folder.id::text||':123:1'`);
    signal.throwIfAborted();
    expect(ids.rows).toHaveLength(1);
    const identity = identitySchema.parse(ids.rows[0]);
    const snapshot = async () => {
      const result = await db.execute(sql`SELECT to_jsonb(i) AS intake,
        (SELECT to_jsonb(m) FROM email_messages m WHERE m.id=i.owned_message_id AND m.account_id=i.account_id) AS message,
        (SELECT to_jsonb(t) FROM email_threads t WHERE t.id=i.baseline_thread_id AND t.account_id=i.account_id) AS thread
        FROM email_private_intake i WHERE i.id=${identity.intake_id} AND i.account_id=${f.accountId}`);
      signal.throwIfAborted();
      expect(result.rows).toHaveLength(1);
      return result.rows[0];
    };
    const canonical = async () => {
      const result = await db.execute(sql`SELECT to_jsonb(m) AS message,to_jsonb(t) AS thread
        FROM email_messages m JOIN email_threads t ON t.id=m.thread_id AND t.account_id=m.account_id
        WHERE m.account_id=${f.accountId} AND m.provider_message_id LIKE 'smtp:%'`);
      signal.throwIfAborted();
      expect(result.rows).toHaveLength(1);
      return result.rows;
    };
    await run({
      identity,
      accountId: f.accountId,
      source,
      snapshot,
      canonical,
      signal,
      attempts: () => notificationAttempts(db, f.notificationId),
      sendCount: () => f.smtp.received.length,
      locatorFingerprint: async () => {
        const result = await db.execute(sql`SELECT source_fingerprint FROM mail_message_locators
          WHERE account_id=${f.accountId} AND folder_id=${identity.folder_id} AND uid_validity='123' AND uid=1`);
        signal.throwIfAborted();
        expect(result.rows).toHaveLength(1);
        return z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .parse(result.rows[0]?.source_fingerprint);
      },
      replay: async (nextSource) => {
        inbox.messages = [{ uid: 1, flags: [], date: IMAP_SYNC_NOW, source: nextSource }];
        await db.execute(sql`UPDATE mail_folders SET last_uid=0 WHERE id=${identity.folder_id}`);
        signal.throwIfAborted();
        return sync();
      },
      appendOrdinary: (nextSource) => {
        inbox.messages.push({ uid: 2, flags: [], date: IMAP_SYNC_NOW, source: nextSource });
        return sync();
      },
    });
  } finally {
    await f.close();
  }
}
