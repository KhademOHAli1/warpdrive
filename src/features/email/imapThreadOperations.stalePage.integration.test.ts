import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import { runImapSyncJob } from "./imapSync";
import { runImapThreadOperation } from "./imapThreadOperations";
import { imapOperationsFixture } from "./imapThreadOperations.test-helpers";

it("does not apply a body page fetched before a confirmed owner remote write", async () => {
  await withTestDb(async (db) => {
    const f = await imapOperationsFixture(db);
    try {
      const inbox = f.server.state.folders.get("INBOX");
      const reply = inbox?.messages[2];
      if (inbox === undefined || reply === undefined) throw new Error("Missing message");
      inbox.messages.push({ ...reply, uid: 4, flags: [] });
      const real = f.runtime.imap.readFolder.bind(f.runtime.imap);
      f.runtime.imap.readFolder = async (args) => {
        const old = await real(args);
        expect(
          await runImapThreadOperation(
            db,
            { actor: f.actor, threadId: f.threadId, operation: { kind: "read", read: true } },
            f.signal,
            f.deps,
          ),
        ).toMatchObject({ ok: true });
        return old;
      };
      expect(
        await runImapSyncJob(db, { accountId: f.accountId, signal: f.signal }, f.deps),
      ).toMatchObject({ ok: true, value: { applied: 0, stale: true } });
      expect(
        (
          await db.execute(
            sql`SELECT uid FROM mail_message_locators WHERE account_id=${f.accountId} AND uid=4`,
          )
        ).rows,
      ).toHaveLength(0);
      expect(
        (
          await db.execute(
            sql`SELECT thread_id FROM email_thread_reads WHERE user_id=${f.owner.id}`,
          )
        ).rows,
      ).toHaveLength(1);
    } finally {
      await f.server.close();
    }
  });
});
