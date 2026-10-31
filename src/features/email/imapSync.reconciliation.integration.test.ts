import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
import { runImapSyncJob } from "./imapSync";
import { IMAP_SYNC_NOW, imapSyncFixture } from "./imapSync.test-helpers";

const signal = () => AbortSignal.timeout(30_000);

describe("IMAP metadata reconciliation", () => {
  it("does not overwrite a newer confirmed read change with an older metadata response", async () => {
    await withTestDb(async (db) => {
      const f = await imapSyncFixture(db);
      try {
        const messages = f.server.state.folders.get("INBOX")?.messages;
        if (messages === undefined) throw new Error("Missing fixture inbox");
        for (const message of messages) message.flags = ["\\Seen"];
        await runImapSyncJob(
          db,
          { accountId: f.accountId, signal: signal(), now: IMAP_SYNC_NOW },
          f.deps,
        );
        const reply = messages[2];
        if (reply === undefined) throw new Error("Missing reply");
        reply.flags = [];
        const realInspect = f.runtime.imap.inspectMessages.bind(f.runtime.imap);
        f.runtime.imap.inspectMessages = async (args) => {
          const oldResult = await realInspect(args);
          reply.flags = ["\\Seen"];
          await db.execute(
            sql`UPDATE mail_message_locators SET flags=ARRAY[${"\\Seen"}]::text[],last_seen_at=now() WHERE account_id=${f.accountId} AND uid=3`,
          );
          return oldResult;
        };
        expect(
          (
            await runImapSyncJob(
              db,
              { accountId: f.accountId, signal: signal(), now: IMAP_SYNC_NOW },
              f.deps,
            )
          ).ok,
        ).toBe(true);
        expect(
          (
            await db.execute(
              sql`SELECT flags FROM mail_message_locators WHERE account_id=${f.accountId} AND uid=3`,
            )
          ).rows,
        ).toEqual([{ flags: ["\\Seen"] }]);
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

  it("mirrors external seen/delete changes for the owner without changing another viewer's read state", async () => {
    await withTestDb(async (db) => {
      const f = await imapSyncFixture(db);
      try {
        expect(
          (
            await runImapSyncJob(
              db,
              { accountId: f.accountId, signal: signal(), now: IMAP_SYNC_NOW },
              f.deps,
            )
          ).ok,
        ).toBe(true);
        const thread = (
          await db.execute(sql`SELECT id FROM email_threads WHERE account_id=${f.accountId}`)
        ).rows[0] as { id: string };
        const viewer = await seedUser(db);
        await db.execute(
          sql`INSERT INTO email_thread_reads (thread_id,user_id,read_at) VALUES (${thread.id},${viewer.id},'2020-01-01T00:00Z')`,
        );
        const inbox = f.server.state.folders.get("INBOX");
        if (inbox === undefined) throw new Error("Missing fixture inbox");
        for (const message of inbox.messages) message.flags = ["\\Seen"];
        const fetched = f.server.state.sourceFetches;
        expect(
          (
            await runImapSyncJob(
              db,
              { accountId: f.accountId, signal: signal(), now: IMAP_SYNC_NOW },
              f.deps,
            )
          ).ok,
        ).toBe(true);
        expect(
          (
            await db.execute(
              sql`SELECT user_id FROM email_thread_reads WHERE thread_id=${thread.id} AND user_id=${f.owner.id}`,
            )
          ).rows,
        ).toHaveLength(1);
        expect(
          (
            await db.execute(
              sql`SELECT read_at='2020-01-01T00:00Z'::timestamptz AS unchanged FROM email_thread_reads WHERE thread_id=${thread.id} AND user_id=${viewer.id}`,
            )
          ).rows,
        ).toEqual([{ unchanged: true }]);
        expect(f.server.state.sourceFetches).toBe(fetched);
        inbox.messages = [];
        expect(
          (
            await runImapSyncJob(
              db,
              { accountId: f.accountId, signal: signal(), now: IMAP_SYNC_NOW },
              f.deps,
            )
          ).ok,
        ).toBe(true);
        expect(
          (
            await db.execute(
              sql`SELECT id FROM mail_message_locators WHERE account_id=${f.accountId} AND active=true`,
            )
          ).rows,
        ).toHaveLength(0);
        expect(
          (
            await db.execute(
              sql`SELECT id FROM email_threads WHERE account_id=${f.accountId} AND trashed_at IS NULL`,
            )
          ).rows,
        ).toHaveLength(0);
        expect(
          (await db.execute(sql`SELECT id FROM email_messages WHERE account_id=${f.accountId}`))
            .rows,
        ).toHaveLength(2);
      } finally {
        await f.server.close();
      }
    });
  });
});
