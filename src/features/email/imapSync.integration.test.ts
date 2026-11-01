import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import { runImapSyncJob } from "./imapSync";
import { IMAP_SYNC_NOW, imapSyncFixture } from "./imapSync.test-helpers";

const signal = () => AbortSignal.timeout(30_000);

describe("native IMAP synchronization with real PostgreSQL", () => {
  it("retains CRM history while hiding invalidated empty epochs and restores confirmed copies", async () => {
    await withTestDb(async (db) => {
      const f = await imapSyncFixture(db);
      try {
        await runImapSyncJob(
          db,
          { accountId: f.accountId, signal: signal(), now: IMAP_SYNC_NOW },
          f.deps,
        );
        const inbox = f.server.state.folders.get("INBOX");
        const reply = inbox?.messages[2];
        if (inbox === undefined || reply === undefined) throw new Error("Missing fixture inbox");
        inbox.validity = "789";
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
              sql`SELECT id FROM email_threads WHERE account_id=${f.accountId} AND trashed_at IS NULL`,
            )
          ).rows,
        ).toHaveLength(0);
        expect(
          (await db.execute(sql`SELECT id FROM email_messages WHERE account_id=${f.accountId}`))
            .rows,
        ).toHaveLength(2);
        inbox.messages.push({ ...reply, uid: 42 });
        expect(
          await runImapSyncJob(
            db,
            { accountId: f.accountId, signal: signal(), now: IMAP_SYNC_NOW },
            f.deps,
          ),
        ).toMatchObject({ ok: true, value: { applied: 0 } });
        expect(
          (
            await db.execute(
              sql`SELECT id FROM email_threads WHERE account_id=${f.accountId} AND trashed_at IS NULL`,
            )
          ).rows,
        ).toHaveLength(1);
      } finally {
        await f.server.close();
      }
    });
  });

  it("imports chosen history with FA/DE content, private threading and stable attachment locators", async () => {
    await withTestDb(async (db) => {
      const f = await imapSyncFixture(db);
      try {
        const synced = await runImapSyncJob(
          db,
          { accountId: f.accountId, signal: signal(), now: IMAP_SYNC_NOW },
          f.deps,
        );
        expect(synced).toMatchObject({ ok: true, value: { applied: 2, stale: false } });
        const messages = (
          await db.execute(
            sql`SELECT subject,body_text,gmail_message_id FROM email_messages WHERE account_id=${f.accountId} ORDER BY created_at,id`,
          )
        ).rows;
        expect(messages).toEqual(
          expect.arrayContaining([
            { subject: "Angebot für Sie", body_text: "Grüße aus Berlin", gmail_message_id: null },
            {
              subject: "پاسخ پیشنهاد همکاری",
              body_text: "از پیشنهاد شما سپاسگزاریم",
              gmail_message_id: null,
            },
          ]),
        );
        expect(messages).toHaveLength(2);
        expect(
          (
            await db.execute(
              sql`SELECT visibility FROM email_threads WHERE account_id=${f.accountId}`,
            )
          ).rows,
        ).toEqual([{ visibility: "private" }]);
        const attachments = (
          await db.execute(
            sql`SELECT filename,gmail_attachment_id,provider_locator FROM email_message_attachments WHERE account_id=${f.accountId}`,
          )
        ).rows;
        expect(attachments).toEqual([
          {
            filename: "پیشنهاد.pdf",
            gmail_attachment_id: null,
            provider_locator: {
              kind: "imap",
              folderPath: "INBOX",
              uidValidity: "123",
              uid: 3,
              partKey: "2",
            },
          },
        ]);
        expect(
          (
            await db.execute(
              sql`SELECT last_uid,uid_validity FROM mail_folders WHERE account_id=${f.accountId}`,
            )
          ).rows,
        ).toEqual([{ last_uid: "3", uid_validity: "123" }]);
        const fetched = f.server.state.sourceFetches;
        expect(
          await runImapSyncJob(
            db,
            { accountId: f.accountId, signal: signal(), now: IMAP_SYNC_NOW },
            f.deps,
          ),
        ).toMatchObject({ ok: true, value: { applied: 0 } });
        expect(f.server.state.sourceFetches).toBe(fetched);
      } finally {
        await f.server.close();
      }
    });
  });

  it("deduplicates identical copies across folders and recovers a UIDVALIDITY reset", async () => {
    await withTestDb(async (db) => {
      const f = await imapSyncFixture(db, ["INBOX", "Sent"]);
      try {
        const inbox = f.server.state.folders.get("INBOX");
        const sent = f.server.state.folders.get("Sent");
        const copied = inbox?.messages[1];
        if (inbox === undefined || sent === undefined || copied === undefined)
          throw new Error("Missing folder fixture");
        sent.messages.push({ ...copied, uid: 1 });
        expect(
          await runImapSyncJob(
            db,
            { accountId: f.accountId, signal: signal(), now: IMAP_SYNC_NOW },
            f.deps,
          ),
        ).toMatchObject({ ok: true, value: { applied: 2 } });
        const before = (
          await db.execute(
            sql`SELECT id FROM email_messages WHERE account_id=${f.accountId} ORDER BY id`,
          )
        ).rows;
        expect(before).toHaveLength(2);
        expect(
          (
            await db.execute(
              sql`SELECT id FROM mail_message_locators WHERE account_id=${f.accountId} AND active=true`,
            )
          ).rows,
        ).toHaveLength(3);
        inbox.validity = "789";
        for (const message of inbox.messages) message.uid += 10;
        expect(
          await runImapSyncJob(
            db,
            { accountId: f.accountId, signal: signal(), now: IMAP_SYNC_NOW },
            f.deps,
          ),
        ).toMatchObject({ ok: true, value: { applied: 0 } });
        expect(
          (
            await db.execute(
              sql`SELECT id FROM email_messages WHERE account_id=${f.accountId} ORDER BY id`,
            )
          ).rows,
        ).toEqual(before);
        expect(
          (
            await db.execute(
              sql`SELECT uid_validity FROM mail_message_locators WHERE account_id=${f.accountId} AND active=true AND uid_validity='123'`,
            )
          ).rows,
        ).toHaveLength(0);
        const attachment = (
          await db.execute(
            sql`SELECT provider_locator FROM email_message_attachments WHERE account_id=${f.accountId}`,
          )
        ).rows[0];
        expect(attachment).toEqual({
          provider_locator: {
            kind: "imap",
            folderPath: "INBOX",
            uidValidity: "789",
            uid: 13,
            partKey: "2",
          },
        });
      } finally {
        await f.server.close();
      }
    });
  });

  it.each(["disconnect", "suspend", "invite"] as const)(
    "discards network results after %s without advancing the cursor",
    async (change) => {
      await withTestDb(async (db) => {
        const f = await imapSyncFixture(db);
        try {
          const realRead = f.runtime.imap.readFolder.bind(f.runtime.imap);
          f.runtime.imap.readFolder = async (args) => {
            const result = await realRead(args);
            if (change === "disconnect")
              await db.execute(
                sql`UPDATE email_accounts SET status='disconnected',connection_generation=2 WHERE id=${f.accountId}`,
              );
            else if (change === "suspend")
              await db.execute(sql`UPDATE users SET is_active=false WHERE id=${f.owner.id}`);
            else await db.execute(sql`UPDATE users SET invited_at=now() WHERE id=${f.owner.id}`);
            return result;
          };
          expect(
            await runImapSyncJob(
              db,
              { accountId: f.accountId, signal: signal(), now: IMAP_SYNC_NOW },
              f.deps,
            ),
          ).toMatchObject({ ok: true, value: { applied: 0, stale: true } });
          expect(
            (await db.execute(sql`SELECT id FROM email_messages WHERE account_id=${f.accountId}`))
              .rows,
          ).toHaveLength(0);
          expect(
            (
              await db.execute(
                sql`SELECT last_uid FROM mail_folders WHERE account_id=${f.accountId}`,
              )
            ).rows,
          ).toEqual([{ last_uid: "0" }]);
        } finally {
          await f.server.close();
        }
      });
    },
  );
});
