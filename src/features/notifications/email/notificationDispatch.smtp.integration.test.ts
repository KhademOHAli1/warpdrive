import { sql } from "drizzle-orm";
import { simpleParser } from "mailparser";
import { expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import { selectDefaultMailbox } from "@/features/email/mailAccountsRepo";
import { dispatchNotificationEmail } from "./notificationDispatch";
import { notificationAttempts, notificationSmtpFixture } from "./notificationDispatch.test-helpers";

it("sends a localized notification through native TLS SMTP once and keeps an untracked private CRM copy", async () => {
  await withTestDb(async (db) => {
    const f = await notificationSmtpFixture(db);
    try {
      await f.locale("fa");
      await db.execute(sql`INSERT INTO signatures (user_id,name,body_html,is_default)
        VALUES (${f.owner.id},'Default','<p>Do not append this signature</p>',true)`);
      const sent = await dispatchNotificationEmail(db, f.input, f.deps);
      expect(sent).toMatchObject({ ok: true, value: { status: "accepted" } });
      expect(f.smtp.received).toHaveLength(1);
      const raw = f.smtp.received[0];
      expect(raw).toBeDefined();
      if (raw) {
        // Reader sanitization intentionally removes these attributes. Inspect the wire MIME.
        const parsed = await simpleParser(raw);
        const recipients =
          parsed.to === undefined ? [] : Array.isArray(parsed.to) ? parsed.to : [parsed.to];
        expect(
          recipients.flatMap((group) => group.value.map((recipient) => recipient.address)),
        ).toEqual([f.runtime.emailAddress]);
        expect(parsed.subject).toContain("یادآوری:");
        expect(parsed.html).toContain('lang="fa" dir="rtl"');
        expect(parsed.html).not.toContain("Do not append this signature");
      }
      expect(
        (
          await db.execute(sql`SELECT t.visibility,t.deal_id,t.person_id FROM email_messages m
        JOIN email_threads t ON t.id=m.thread_id WHERE m.account_id=${f.accountId}`)
        ).rows,
      ).toEqual([{ visibility: "private", deal_id: null, person_id: null }]);
      expect((await db.execute(sql`SELECT id FROM email_tracking_tokens`)).rows).toHaveLength(0);
      expect(
        (
          await db.execute(
            sql`SELECT email_sent_at FROM notifications WHERE id=${f.notificationId}`,
          )
        ).rows[0]?.email_sent_at,
      ).not.toBeNull();
      await dispatchNotificationEmail(db, f.input, f.deps);
      expect(f.smtp.received).toHaveLength(1);
    } finally {
      await f.close();
    }
  });
});

it("keeps a lost-ack notification pinned after the default changes and never sends it through another mailbox", async () => {
  await withTestDb(async (db) => {
    const f = await notificationSmtpFixture(db, { dropAfterData: true });
    try {
      const second = await f.addSecondMailbox();
      expect(await dispatchNotificationEmail(db, f.input, f.deps)).toMatchObject({
        ok: true,
        value: { status: "needs_review" },
      });
      expect(f.smtp.received).toHaveLength(1);
      const frozen = structuredClone(
        (await notificationAttempts(db, f.notificationId))[0]?.payload,
      );
      expect(await selectDefaultMailbox(db, f.owner.id, second, f.args.signal)).toMatchObject({
        ok: true,
      });
      f.loadedAccounts.length = 0;
      expect(await dispatchNotificationEmail(db, f.input, f.deps)).toMatchObject({
        ok: true,
        value: { status: "needs_review" },
      });
      expect(f.loadedAccounts).not.toContain(second);
      expect(f.smtp.received).toHaveLength(1);
      const attempts = await notificationAttempts(db, f.notificationId);
      expect(attempts).toHaveLength(1);
      expect(attempts[0]).toMatchObject({ account_id: f.accountId });
      expect(attempts[0]?.payload).toEqual(frozen);
      expect(
        (
          await db.execute(
            sql`SELECT email_sent_at FROM notifications WHERE id=${f.notificationId}`,
          )
        ).rows[0]?.email_sent_at,
      ).toBeNull();
    } finally {
      await f.close();
    }
  });
});

it("repairs an accepted receipt after CRM-copy and marker faults, preserving its mailbox after a default change", async () => {
  await withTestDb(async (db) => {
    const f = await notificationSmtpFixture(db);
    try {
      const second = await f.addSecondMailbox();
      await db.execute(sql`CREATE FUNCTION notification_fixture_copy_failure() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'synthetic CRM copy failure'; END $$`);
      await db.execute(sql`CREATE TRIGGER notification_fixture_copy_failure BEFORE INSERT ON email_messages
        FOR EACH ROW EXECUTE FUNCTION notification_fixture_copy_failure()`);
      await db.execute(sql`CREATE FUNCTION notification_fixture_marker_failure() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.email_sent_at IS NOT NULL THEN RAISE EXCEPTION 'synthetic marker failure'; END IF; RETURN NEW; END $$`);
      await db.execute(sql`CREATE TRIGGER notification_fixture_marker_failure BEFORE UPDATE OF email_sent_at ON notifications
        FOR EACH ROW EXECUTE FUNCTION notification_fixture_marker_failure()`);
      const interrupted = await dispatchNotificationEmail(db, f.input, f.deps);
      expect(interrupted.ok && interrupted.value.status === "accepted").toBe(false);
      expect(f.smtp.received).toHaveLength(1);
      const receipt = await notificationAttempts(db, f.notificationId);
      expect(receipt).toHaveLength(1);
      expect(receipt[0]).toMatchObject({
        account_id: f.accountId,
        delivery_outcome: { state: "accepted" },
      });
      expect(
        (await db.execute(sql`SELECT id FROM email_messages WHERE account_id=${f.accountId}`)).rows,
      ).toHaveLength(0);
      expect(
        (
          await db.execute(
            sql`SELECT email_sent_at FROM notifications WHERE id=${f.notificationId}`,
          )
        ).rows[0]?.email_sent_at,
      ).toBeNull();
      const frozen = structuredClone(receipt[0]?.payload);
      await db.execute(sql`DROP TRIGGER notification_fixture_copy_failure ON email_messages`);
      await db.execute(sql`DROP TRIGGER notification_fixture_marker_failure ON notifications`);
      expect(await selectDefaultMailbox(db, f.owner.id, second, f.args.signal)).toMatchObject({
        ok: true,
      });
      f.loadedAccounts.length = 0;
      expect(await dispatchNotificationEmail(db, f.input, f.deps)).toMatchObject({
        ok: true,
        value: { status: "accepted" },
      });
      expect(f.smtp.received).toHaveLength(1);
      expect(f.smtp.authenticationAttempts()).toBe(1);
      expect(f.loadedAccounts).toHaveLength(0);
      const repaired = await notificationAttempts(db, f.notificationId);
      expect(repaired).toHaveLength(1);
      expect(repaired[0]).toMatchObject({ id: receipt[0]?.id, account_id: f.accountId });
      expect(repaired[0]?.payload).toEqual(frozen);
      expect(
        (
          await db.execute(
            sql`SELECT email_sent_at FROM notifications WHERE id=${f.notificationId}`,
          )
        ).rows[0]?.email_sent_at,
      ).not.toBeNull();
      expect(
        (await db.execute(sql`SELECT id FROM email_messages WHERE account_id=${f.accountId}`)).rows,
      ).toHaveLength(1);
    } finally {
      await f.close();
    }
  });
});

it("serializes concurrent notification delivery without a second native SMTP send", async () => {
  await withTestDb(async (db) => {
    const f = await notificationSmtpFixture(db);
    try {
      const results = await Promise.all([
        dispatchNotificationEmail(db, f.input, f.deps),
        dispatchNotificationEmail(db, f.input, f.deps),
      ]);
      expect(results.every((result) => result.ok)).toBe(true);
      expect(f.smtp.received).toHaveLength(1);
      expect(await notificationAttempts(db, f.notificationId)).toHaveLength(1);
      expect(
        (await db.execute(sql`SELECT id FROM email_messages WHERE account_id=${f.accountId}`)).rows,
      ).toHaveLength(1);
    } finally {
      await f.close();
    }
  });
});
