import { sql } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { withTestDb } from "@/db/testing";
import { resolveOutboundLink } from "@/features/email/linking";
import { hydrateOwner } from "@/features/email/syncCursor";
import { runSendJob } from "@/features/email/worker";
import {
  enqueueRetainedNotification,
  notificationSmtpFixture,
} from "./notificationDispatch.test-helpers";

it("keeps native SMTP notifications unlinked and never calls Sent APPEND despite mailbox defaults", async () => {
  await withTestDb(async (db) => {
    const f = await notificationSmtpFixture(db);
    const append = vi.spyOn(f.runtime.imap, "appendSent");
    try {
      const contact = (
        await db.execute(sql`INSERT INTO persons (name,primary_email,owner_id,visibility_level)
        VALUES ('Matching notification recipient',${f.runtime.emailAddress},${f.owner.id},'all') RETURNING id`)
      ).rows[0] as { id: string } | undefined;
      expect(contact).toBeDefined();
      if (contact === undefined) return;
      await db.execute(sql`UPDATE deals SET person_id=${contact.id} WHERE id=${f.dealId}`);
      await db.execute(sql`UPDATE email_accounts SET connection_settings=
        '{"sentCopyMode":"append","sentFolderPath":"Sent"}'::jsonb WHERE id=${f.accountId}`);
      const owner = await hydrateOwner(db, f.owner.id, f.args.signal);
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
          f.args.signal,
        ),
      ).toMatchObject({ kind: "linked", personId: contact.id, dealId: f.dealId });
      expect(await enqueueRetainedNotification(db, f)).toMatchObject({ ok: true });
      const args = {
        accountId: f.accountId,
        idempotencyKey: f.notificationId,
        signal: f.args.signal,
      };
      expect(await runSendJob(db, args, f.deps)).toMatchObject({
        ok: true,
        value: { status: "sent" },
      });
      expect(f.smtp.received).toHaveLength(1);
      const copies = (
        await db.execute(sql`SELECT t.visibility,t.deal_id,t.person_id FROM email_messages m
        JOIN email_threads t ON t.id=m.thread_id AND t.account_id=m.account_id WHERE m.account_id=${f.accountId}`)
      ).rows;
      expect.soft(copies).toEqual([{ visibility: "private", deal_id: null, person_id: null }]);
      expect.soft(append).not.toHaveBeenCalled();
      expect.soft(f.imap.state.folders.get("Sent")?.messages).toHaveLength(0);
      expect((await db.execute(sql`SELECT id FROM email_tracking_tokens`)).rows).toHaveLength(0);
      await runSendJob(db, args, f.deps);
      expect(f.smtp.received).toHaveLength(1);
      expect(
        (await db.execute(sql`SELECT id FROM email_messages WHERE account_id=${f.accountId}`)).rows,
      ).toHaveLength(1);
      expect.soft(append).not.toHaveBeenCalled();
    } finally {
      append.mockRestore();
      await f.close();
    }
  });
});
