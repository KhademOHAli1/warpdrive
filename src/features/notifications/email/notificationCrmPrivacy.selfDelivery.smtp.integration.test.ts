import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import { runImapSyncJob } from "@/features/email/imapSync";
import { IMAP_SYNC_NOW } from "@/features/email/imapSync.test-helpers";
import { resolveOutboundLink } from "@/features/email/linking";
import { hydrateOwner } from "@/features/email/syncCursor";
import { runSendJob } from "@/features/email/worker";
import { ok } from "@/types/result";
import {
  enqueueRetainedNotification,
  notificationAttempts,
  notificationSmtpFixture,
} from "./notificationDispatch.test-helpers";

it("keeps actual SMTP self-delivery private and unlinked when its raw message returns through TLS IMAP INBOX", async () => {
  await withTestDb(async (db) => {
    const f = await notificationSmtpFixture(db);
    try {
      const signal = f.args.signal;
      const person = (
        await db.execute(sql`INSERT INTO persons
        (name,primary_email,owner_id,visibility_level)
        VALUES ('Self-delivery contact',${f.runtime.emailAddress},${f.owner.id},'all') RETURNING id`)
      ).rows[0] as { id: string } | undefined;
      expect(person).toBeDefined();
      if (person === undefined) return;
      await db.execute(sql`UPDATE deals SET person_id=${person.id} WHERE id=${f.dealId}`);
      const owner = await hydrateOwner(db, f.owner.id, signal);
      expect(owner.ok).toBe(true);
      if (!owner.ok) return;
      expect(
        await resolveOutboundLink(
          db,
          {
            owner: owner.value,
            fromEmail: f.runtime.emailAddress,
            recipients: [f.runtime.emailAddress],
          },
          signal,
        ),
      ).toMatchObject({ kind: "linked", personId: person.id, dealId: f.dealId });
      expect(await enqueueRetainedNotification(db, f)).toMatchObject({ ok: true });
      const sendArgs = { accountId: f.accountId, idempotencyKey: f.notificationId, signal };
      expect(await runSendJob(db, sendArgs, f.deps)).toMatchObject({
        ok: true,
        value: { status: "sent" },
      });
      expect(f.smtp.received).toHaveLength(1);
      const canonicalSnapshot = async () => {
        const result = await db.execute(sql`SELECT m.id AS message_id,
          to_jsonb(m) AS message,to_jsonb(t) AS thread
          FROM email_messages m JOIN email_threads t ON t.id=m.thread_id AND t.account_id=m.account_id
          WHERE m.account_id=${f.accountId} AND m.provider_message_id LIKE 'smtp:%'`);
        signal.throwIfAborted();
        return result.rows;
      };
      const canonical = await canonicalSnapshot();
      expect(canonical).toHaveLength(1);
      const attempts = await notificationAttempts(db, f.notificationId);
      const raw = f.smtp.received[0];
      const inbox = f.imap.state.folders.get("INBOX");
      expect(raw).toBeDefined();
      expect(inbox).toBeDefined();
      if (raw === undefined || inbox === undefined) return;
      // Real delivery adds transport headers. Do not let exact raw-source
      // deduplication hide the separate INBOX intake/autolinking path.
      const received = Buffer.concat([
        Buffer.from(
          "Received: from relay.mail.test by inbox.mail.test; Sat, 31 Oct 2026 13:00:00 +0000\r\n",
        ),
        raw,
      ]);
      expect(received.equals(raw)).toBe(false);
      inbox.messages = [{ uid: 1, flags: [], date: IMAP_SYNC_NOW, source: received }];
      const syncArgs = { accountId: f.accountId, signal, now: IMAP_SYNC_NOW };
      const syncDeps = { loadConnection: () => Promise.resolve(ok(f.runtime)) };
      expect(await runImapSyncJob(db, syncArgs, syncDeps)).toMatchObject({
        ok: true,
        value: { applied: 1, stale: false },
      });
      const observedSnapshot = async () => {
        const result = await db.execute(sql`SELECT l.message_id,m.thread_id,t.visibility,
          t.person_id,t.deal_id,t.lead_id,to_jsonb(m) AS message,to_jsonb(t) AS thread
          FROM mail_message_locators l
          JOIN mail_folders folder ON folder.id=l.folder_id AND folder.account_id=l.account_id
          JOIN email_messages m ON m.id=l.message_id AND m.account_id=l.account_id
          JOIN email_threads t ON t.id=m.thread_id AND t.account_id=m.account_id
          WHERE l.account_id=${f.accountId} AND folder.path='INBOX'
            AND l.uid_validity='123' AND l.uid=1 AND l.active`);
        signal.throwIfAborted();
        return result.rows;
      };
      const observed = await observedSnapshot();
      expect(observed).toHaveLength(1);
      expect.soft(observed[0]).toMatchObject({
        visibility: "private",
        person_id: null,
        deal_id: null,
        lead_id: null,
      });
      expect.soft(observed[0]?.message_id).not.toBe(canonical[0]?.message_id);
      expect.soft(await canonicalSnapshot()).toEqual(canonical);
      expect.soft(await notificationAttempts(db, f.notificationId)).toEqual(attempts);
      expect(await runImapSyncJob(db, syncArgs, syncDeps)).toMatchObject({
        ok: true,
        value: { applied: 0, stale: false },
      });
      expect.soft(await observedSnapshot()).toEqual(observed);
      expect.soft(await canonicalSnapshot()).toEqual(canonical);
      expect.soft(await notificationAttempts(db, f.notificationId)).toEqual(attempts);
      expect(
        (
          await db.execute(sql`SELECT id FROM email_tracking_tokens
        WHERE send_attempt_id IN (SELECT id FROM email_send_attempts WHERE account_id=${f.accountId})`)
        ).rows,
      ).toHaveLength(0);
      expect(
        (await db.execute(sql`SELECT id FROM email_messages WHERE account_id=${f.accountId}`)).rows,
      ).toHaveLength(2);
      expect(f.imap.state.folders.get("Sent")?.messages).toHaveLength(0);
      await runSendJob(db, sendArgs, f.deps);
      expect(f.smtp.received).toHaveLength(1);
      expect.soft(await observedSnapshot()).toEqual(observed);
    } finally {
      await f.close();
    }
  });
});
