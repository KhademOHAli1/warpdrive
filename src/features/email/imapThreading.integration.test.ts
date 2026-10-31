import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import { runImapSyncJob } from "./imapSync";
import { IMAP_SYNC_NOW, imapSyncFixture } from "./imapSync.test-helpers";

it("creates a separate private thread when reference candidate discovery is truncated", async () => {
  await withTestDb(async (db) => {
    const f = await imapSyncFixture(db);
    try {
      const threadId = randomUUID();
      await db.execute(sql`INSERT INTO email_threads (id,account_id,provider_thread_id,visibility)
        VALUES (${threadId},${f.accountId},'synthetic-reference','private')`);
      await db.execute(sql`INSERT INTO email_messages (account_id,thread_id,provider_message_id,rfc_message_id,direction,from_email,to_emails,sent_at)
        SELECT ${f.accountId},${threadId},'synthetic:' || n::text,'<original@mail.test>','inbound','client@mail.test',
          ${JSON.stringify([f.runtime.emailAddress])}::jsonb,now() FROM generate_series(1,200) n`);
      const inbox = f.server.state.folders.get("INBOX");
      const reply = inbox?.messages[2];
      if (inbox === undefined || reply === undefined) throw new Error("Missing reply fixture");
      inbox.messages = [reply];
      expect(
        await runImapSyncJob(
          db,
          { accountId: f.accountId, signal: AbortSignal.timeout(30000), now: IMAP_SYNC_NOW },
          f.deps,
        ),
      ).toMatchObject({ ok: true, value: { applied: 1 } });
      const [imported] = (
        await db.execute(sql`SELECT m.thread_id,t.visibility FROM email_messages m
        JOIN email_threads t ON t.id=m.thread_id WHERE m.account_id=${f.accountId} AND m.rfc_message_id='<reply@mail.test>'`)
      ).rows;
      expect(imported?.thread_id).not.toBe(threadId);
      expect(imported?.visibility).toBe("private");
    } finally {
      await f.server.close();
    }
  });
});
