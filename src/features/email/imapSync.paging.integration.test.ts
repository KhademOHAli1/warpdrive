import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import { runImapSyncJob } from "./imapSync";
import { IMAP_SYNC_NOW, imapSyncFixture } from "./imapSync.test-helpers";
import { buildMime } from "./mime";

const signal = () => AbortSignal.timeout(60_000);

it("resumes a mailbox larger than one bounded page without duplicate threads or messages", async () => {
  await withTestDb(async (db) => {
    const f = await imapSyncFixture(db);
    try {
      const inbox = f.server.state.folders.get("INBOX");
      if (inbox === undefined) throw new Error("Missing inbox");
      inbox.messages = Array.from({ length: 105 }, (_, index) => ({
        uid: index + 1,
        date: new Date("2026-10-30T12:00Z"),
        flags: [],
        source: Buffer.from(
          buildMime({
            from: "client@mail.test",
            to: [f.runtime.emailAddress],
            subject: `پیام / Nachricht ${index}`,
            html: "<p>آزمایش / Prüfung</p>",
            messageId: `<batch-${index}@mail.test>`,
          }),
        ),
      }));
      const args = { accountId: f.accountId, signal: signal(), now: IMAP_SYNC_NOW };
      expect(await runImapSyncJob(db, args, { ...f.deps, maxPages: 1 })).toMatchObject({
        ok: true,
        value: { applied: 100, more: true, stale: false },
      });
      expect(
        (await db.execute(sql`SELECT last_uid FROM mail_folders WHERE account_id=${f.accountId}`))
          .rows,
      ).toEqual([{ last_uid: "100" }]);
      expect(await runImapSyncJob(db, args, { ...f.deps, maxPages: 1 })).toMatchObject({
        ok: true,
        value: { applied: 5, more: false },
      });
      expect(
        (await db.execute(sql`SELECT id FROM email_messages WHERE account_id=${f.accountId}`)).rows,
      ).toHaveLength(105);
    } finally {
      await f.server.close();
    }
  });
});

it("serializes competing mailbox jobs without duplicate imported messages", async () => {
  await withTestDb(async (db) => {
    const f = await imapSyncFixture(db);
    try {
      const args = { accountId: f.accountId, signal: signal(), now: IMAP_SYNC_NOW };
      const results = await Promise.all([
        runImapSyncJob(db, args, f.deps),
        runImapSyncJob(db, args, f.deps),
      ]);
      expect(results.every((result) => result.ok)).toBe(true);
      expect(
        (await db.execute(sql`SELECT id FROM email_messages WHERE account_id=${f.accountId}`)).rows,
      ).toHaveLength(2);
      expect(
        (await db.execute(sql`SELECT id FROM email_threads WHERE account_id=${f.accountId}`)).rows,
      ).toHaveLength(1);
      expect(
        (
          await db.execute(
            sql`SELECT id FROM mail_message_locators WHERE account_id=${f.accountId}`,
          )
        ).rows,
      ).toHaveLength(2);
    } finally {
      await f.server.close();
    }
  });
});

it("keeps identical sources separate across accounts and enforces locator foreign-key scope", async () => {
  await withTestDb(async (db) => {
    const first = await imapSyncFixture(db);
    const second = await imapSyncFixture(db);
    try {
      const originals = first.server.state.folders.get("INBOX")?.messages;
      const target = second.server.state.folders.get("INBOX");
      if (originals === undefined || target === undefined) throw new Error("Missing inbox");
      target.messages = originals.map((message) => ({ ...message }));
      await runImapSyncJob(
        db,
        { accountId: first.accountId, signal: signal(), now: IMAP_SYNC_NOW },
        first.deps,
      );
      await runImapSyncJob(
        db,
        { accountId: second.accountId, signal: signal(), now: IMAP_SYNC_NOW },
        second.deps,
      );
      const firstRows = (
        await db.execute(sql`SELECT id FROM email_messages WHERE account_id=${first.accountId}`)
      ).rows as { id: string }[];
      const secondRows = (
        await db.execute(sql`SELECT id FROM email_messages WHERE account_id=${second.accountId}`)
      ).rows as { id: string }[];
      expect(firstRows).toHaveLength(2);
      expect(secondRows).toHaveLength(2);
      expect(new Set([...firstRows, ...secondRows].map((row) => row.id)).size).toBe(4);
      const folder = (
        await db.execute(sql`SELECT id FROM mail_folders WHERE account_id=${first.accountId}`)
      ).rows[0] as { id: string };
      const foreignMessage = secondRows[0];
      if (foreignMessage === undefined) throw new Error("Missing second message");
      await expect(
        db.execute(sql`INSERT INTO mail_message_locators (account_id,folder_id,uid_validity,uid,message_id)
        VALUES (${first.accountId},${folder.id},'123',999,${foreignMessage.id})`),
      ).rejects.toThrow();
    } finally {
      await first.server.close();
      await second.server.close();
    }
  });
});
