import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { expect } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import {
  enqueueRetainedNotification,
  type NotificationSmtpFixture,
  notificationSmtpFixture,
} from "@/features/notifications/email/notificationDispatch.test-helpers";
import { ok } from "@/types/result";
import { runImapSyncJob } from "./imapSync";
import { IMAP_SYNC_NOW } from "./imapSync.test-helpers";
import { enqueueSend } from "./outbox";
import { runSendJob } from "./worker";

// This deliberately models a legacy/tampered already-admitted queue row. It does not
// assert enqueue admission: the actual final dispatcher must independently fence it.
export async function enqueueHeldDispatchBypass(
  db: Db,
  accountId: string,
  threadId: string,
  signal: AbortSignal,
) {
  const idempotencyKey = randomUUID();
  const queued = await enqueueSend(db, {
    accountId,
    idempotencyKey,
    threadId: null,
    payload: {
      to: ["customer@example.test"],
      subject: "پاسخ خصوصی / Private Antwort",
      html: "<p>پاسخ خصوصی / Private Antwort</p>",
      trackOpens: false,
      trackLinks: false,
    },
  });
  signal.throwIfAborted();
  expect(queued.ok).toBe(true);
  if (!queued.ok) throw queued.error;
  await db.execute(sql`UPDATE email_send_attempts SET thread_id=${threadId}
    WHERE id=${queued.value.attemptId} AND account_id=${accountId}`);
  signal.throwIfAborted();
  expect(
    (
      await db.execute(sql`SELECT status,payload_prepared,send_started_at,delivery_outcome
    FROM email_send_attempts WHERE id=${queued.value.attemptId}`)
    ).rows,
  ).toEqual([
    { status: "pending", payload_prepared: true, send_started_at: null, delivery_outcome: null },
  ]);
  return { attemptId: queued.value.attemptId, idempotencyKey };
}

export async function privateDispatchSnapshot(db: Db, accountId: string, signal: AbortSignal) {
  const result = await db.execute(sql`SELECT jsonb_build_object(
    'messages',(SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.id),'[]'::jsonb)
      FROM email_messages m WHERE m.account_id=${accountId}),
    'threads',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]'::jsonb)
      FROM email_threads t WHERE t.account_id=${accountId}),
    'intake',(SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY i.id),'[]'::jsonb)
      FROM email_private_intake i WHERE i.account_id=${accountId}),
    'reviews',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.intake_id,r.revision),'[]'::jsonb)
      FROM email_private_intake_reviews r WHERE r.account_id=${accountId}),
    'attempts',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]'::jsonb)
      FROM email_send_attempts s WHERE s.account_id=${accountId}),
    'locators',(SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY l.id),'[]'::jsonb)
      FROM mail_message_locators l WHERE l.account_id=${accountId}),
    'reads',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.thread_id,r.user_id),'[]'::jsonb)
      FROM email_thread_reads r JOIN email_threads t ON t.id=r.thread_id
      WHERE t.account_id=${accountId}),
    'tracking',(SELECT coalesce(jsonb_agg(to_jsonb(k) ORDER BY k.id),'[]'::jsonb)
      FROM email_tracking_tokens k JOIN email_send_attempts s ON s.id=k.send_attempt_id
      WHERE s.account_id=${accountId}),
    'notifications',(SELECT coalesce(jsonb_agg(to_jsonb(n) ORDER BY n.id),'[]'::jsonb)
      FROM notifications n JOIN email_accounts a ON a.user_id=n.user_id WHERE a.id=${accountId})
    ) AS snapshot`);
  signal.throwIfAborted();
  return result.rows;
}

export function privateDispatchRemoteSnapshot(f: NotificationSmtpFixture) {
  return Array.from(f.imap.state.folders, ([path, folder]) => ({
    path,
    validity: folder.validity,
    readOnly: folder.readOnly,
    specialUse: folder.specialUse ?? null,
    messages: folder.messages.map((message) => ({
      uid: message.uid,
      flags: [...message.flags],
      date: message.date.toISOString(),
      source: message.source.toString("base64"),
    })),
  }));
}

export async function heldSmtpDispatchFixture(db: Db) {
  const f = await notificationSmtpFixture(db);
  try {
    const signal = f.args.signal;
    // Prove privacy denial independently of coarse mailbox capability denial.
    await db.execute(sql`UPDATE email_accounts SET capabilities=
      '{"read":true,"send":true,"markRead":true,"move":true,"trash":true}'::jsonb
      WHERE id=${f.accountId}`);
    signal.throwIfAborted();
    f.imap.state.folders.set("Archiv", { validity: "987", readOnly: false, messages: [] });
    f.imap.state.folders.set("Trash", {
      validity: "789",
      readOnly: false,
      messages: [],
      specialUse: "\\Trash",
    });
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
    if (raw === undefined || inbox === undefined)
      throw new AppError(ERROR_IDS.DB_INVARIANT, "Private dispatch protocol fixture missing");
    inbox.messages = [
      {
        uid: 1,
        flags: [],
        date: IMAP_SYNC_NOW,
        source: Buffer.concat([
          Buffer.from(
            "Received: from relay.mail.test by inbox.mail.test; Sat, 31 Oct 2026 13:00:00 +0000\r\n",
          ),
          raw,
        ]),
      },
    ];
    expect(
      await runImapSyncJob(
        db,
        {
          accountId: f.accountId,
          signal,
          now: IMAP_SYNC_NOW,
        },
        { loadConnection: () => Promise.resolve(ok(f.runtime)) },
      ),
    ).toMatchObject({
      ok: true,
      value: { applied: 1, stale: false },
    });
    const held = (
      await db.execute(sql`SELECT i.id,t.id AS thread_id,
      m.provider_message_id,m.gmail_message_id,t.visibility,t.person_id,t.deal_id,t.lead_id
      FROM email_private_intake i JOIN email_messages m
        ON m.id=i.owned_message_id AND m.account_id=i.account_id
      JOIN email_threads t ON t.id=m.thread_id AND t.account_id=m.account_id
      JOIN mail_message_locators l ON l.message_id=m.id AND l.account_id=m.account_id
      JOIN mail_folders f ON f.id=l.folder_id AND f.account_id=l.account_id
      WHERE i.account_id=${f.accountId} AND i.provider='imap_smtp'
        AND i.intake_state='unverified' AND f.path='INBOX' AND l.uid=1 AND l.active`)
    ).rows;
    signal.throwIfAborted();
    expect(held).toHaveLength(1);
    const row = held[0];
    if (typeof row?.thread_id !== "string" || typeof row.id !== "string")
      throw new AppError(ERROR_IDS.DB_INVARIANT, "Actual private IMAP intake fixture missing");
    expect(row).toMatchObject({
      provider_message_id: `private-intake:${row.id}`,
      gmail_message_id: null,
      visibility: "private",
      person_id: null,
      deal_id: null,
      lead_id: null,
    });
    return { ...f, threadId: row.thread_id, intakeId: row.id };
  } catch (error) {
    await f.close();
    throw error;
  }
}
