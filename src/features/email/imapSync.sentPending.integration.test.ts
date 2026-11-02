import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import { ok } from "@/types/result";
import { runImapSyncJob } from "./imapSync";
import { IMAP_SYNC_NOW } from "./imapSync.test-helpers";
import { processSmtpSendAttempt } from "./smtpOutbox";
import { smtpOutboxFixture } from "./smtpOutbox.test-helpers";

it("defers a qualified Sent source until its accepted SMTP CRM copy exists", async () => {
  await withTestDb(async (db) => {
    const f = await smtpOutboxFixture(db);
    try {
      await f.enqueue();
      expect(await processSmtpSendAttempt(db, f.args)).toMatchObject({
        ok: true,
        value: { status: "sent" },
      });
      const [copy] = (
        await db.execute(
          sql`SELECT id,thread_id FROM email_messages WHERE account_id=${f.accountId}`,
        )
      ).rows;
      if (typeof copy?.id !== "string" || typeof copy.thread_id !== "string")
        throw new Error("Missing accepted CRM copy");
      // Isolate the durable-receipt-before-CRM-store interval using the real committed receipt.
      await db.execute(sql`DELETE FROM email_messages WHERE id=${copy.id}`);
      const sent = f.imap.state.folders.get("Sent");
      const raw = f.smtp.received[0];
      if (sent === undefined || raw === undefined) throw new Error("Missing accepted Sent source");
      sent.messages = [
        {
          uid: 1,
          flags: ["\\Seen"],
          date: IMAP_SYNC_NOW,
          source: Buffer.concat([Buffer.from("Received: by synthetic.mail.test\r\n"), raw]),
        },
      ];
      f.runtime.folderPaths = ["Sent"];
      const deps = { loadConnection: () => Promise.resolve(ok(f.runtime)) };
      expect(
        await runImapSyncJob(
          db,
          { accountId: f.accountId, signal: f.args.signal, now: IMAP_SYNC_NOW },
          deps,
        ),
      ).toMatchObject({ ok: true, value: { applied: 0, more: true } });
      expect(
        (await db.execute(sql`SELECT last_uid FROM mail_folders WHERE account_id=${f.accountId}`))
          .rows,
      ).toEqual([{ last_uid: "0" }]);
      expect(
        (await db.execute(sql`SELECT id FROM email_messages WHERE account_id=${f.accountId}`)).rows,
      ).toHaveLength(0);
      await db.execute(sql`INSERT INTO email_messages (id,thread_id,account_id,provider_message_id,rfc_message_id,direction,from_email)
        VALUES (${copy.id},${copy.thread_id},${f.accountId},${`smtp:${f.attemptId}`},${`<${f.attemptId}@mail.test>`},'outbound','owner@mail.test')`);
      expect(
        await runImapSyncJob(
          db,
          { accountId: f.accountId, signal: f.args.signal, now: IMAP_SYNC_NOW },
          deps,
        ),
      ).toMatchObject({ ok: true, value: { applied: 0, more: false } });
      expect(
        (
          await db.execute(
            sql`SELECT message_id FROM mail_message_locators WHERE account_id=${f.accountId}`,
          )
        ).rows,
      ).toEqual([{ message_id: copy.id }]);
    } finally {
      await f.close();
    }
  });
});
