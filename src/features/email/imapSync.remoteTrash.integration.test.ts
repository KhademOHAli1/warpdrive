import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import { runImapSyncJob } from "./imapSync";
import { IMAP_SYNC_NOW, imapSyncFixture } from "./imapSync.test-helpers";
import { imapOperationsFixture } from "./imapThreadOperations.test-helpers";
import { buildMime } from "./mime";

it.each(["all_copy", "stale_page", "new_reply"] as const)(
  "preserves explicit remote-trash intent after %s",
  async (kind) => {
    await withTestDb(async (db) => {
      const f = await imapOperationsFixture(db);
      try {
        const inbox = f.server.state.folders.get("INBOX");
        const reply = inbox?.messages[2];
        if (inbox === undefined || reply === undefined) throw new Error("Missing reply fixture");
        if (kind === "all_copy") {
          f.server.state.folders.set("All", {
            validity: "999",
            readOnly: false,
            messages: [{ ...reply, uid: 1 }],
            specialUse: "\\All",
          });
          f.runtime.folderPaths = ["All"];
        } else {
          const source =
            kind === "new_reply"
              ? Buffer.from(
                  buildMime({
                    from: "client@mail.test",
                    to: [f.runtime.emailAddress],
                    subject: "Neue Nachricht / پیام تازه",
                    html: "<p>Vielen Dank</p>",
                    messageId: "<after-trash@mail.test>",
                    inReplyTo: "<reply@mail.test>",
                    references: "<reply@mail.test>",
                  }),
                )
              : reply.source;
          inbox.messages.push({ ...reply, uid: 4, source });
        }
        const stamp = () =>
          db.execute(
            sql`UPDATE email_threads SET remote_trashed_at=now(),trashed_at=now() WHERE id=${f.threadId}`,
          );
        if (kind === "stale_page") {
          const real = f.runtime.imap.readFolder.bind(f.runtime.imap);
          f.runtime.imap.readFolder = async (args) => {
            const read = await real(args);
            await stamp();
            return read;
          };
        } else await stamp();
        expect(
          await runImapSyncJob(
            db,
            { accountId: f.accountId, signal: f.signal, now: IMAP_SYNC_NOW },
            f.deps,
          ),
        ).toMatchObject({ ok: true });
        const [original] = (
          await db.execute(
            sql`SELECT trashed_at,remote_trashed_at FROM email_threads WHERE id=${f.threadId}`,
          )
        ).rows;
        expect(original?.trashed_at).not.toBeNull();
        expect(original?.remote_trashed_at).not.toBeNull();
        if (kind === "new_reply") {
          const [fresh] = (
            await db.execute(
              sql`SELECT m.thread_id,t.visibility,t.trashed_at FROM email_messages m JOIN email_threads t ON t.id=m.thread_id WHERE m.account_id=${f.accountId} AND m.rfc_message_id='<after-trash@mail.test>'`,
            )
          ).rows;
          expect(fresh?.thread_id).not.toBe(f.threadId);
          expect(fresh).toMatchObject({ visibility: "private", trashed_at: null });
        }
      } finally {
        await f.server.close();
      }
    });
  },
);

it("excludes authoritative Trash and Junk from ordinary history while keeping guessed names selectable", async () => {
  await withTestDb(async (db) => {
    const f = await imapSyncFixture(db);
    try {
      const sample = f.server.state.folders.get("INBOX")?.messages[1];
      if (sample === undefined) throw new Error("Missing message fixture");
      for (const [path, specialUse] of [
        ["Deleted Items", "\\Trash"],
        ["Junk", "\\Junk"],
        ["Trash", null],
      ] as const)
        f.server.state.folders.set(path, {
          validity: "999",
          readOnly: false,
          messages: [{ ...sample, uid: 1 }],
          specialUse,
        });
      f.runtime.folderPaths = ["Deleted Items", "Junk", "Trash"];
      expect(
        await runImapSyncJob(
          db,
          { accountId: f.accountId, signal: AbortSignal.timeout(30000), now: IMAP_SYNC_NOW },
          f.deps,
        ),
      ).toMatchObject({ ok: true, value: { applied: 1 } });
      expect(
        (await db.execute(sql`SELECT path FROM mail_folders WHERE account_id=${f.accountId}`)).rows,
      ).toEqual([{ path: "Trash" }]);
    } finally {
      await f.server.close();
    }
  });
});
