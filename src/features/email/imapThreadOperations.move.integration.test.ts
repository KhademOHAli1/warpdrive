import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import { runImapSyncJob } from "./imapSync";
import { runImapThreadOperation } from "./imapThreadOperations";
import { imapOperationsFixture } from "./imapThreadOperations.test-helpers";

it("moves only tracked UIDs and keeps authoritative COPYUID identities and attachments", async () => {
  await withTestDb(async (db) => {
    const f = await imapOperationsFixture(db);
    try {
      f.runtime.folderPaths = ["INBOX", "Archiv"];
      const before = (
        await db.execute(
          sql`SELECT id FROM email_messages WHERE account_id=${f.accountId} ORDER BY id`,
        )
      ).rows;
      expect(
        await runImapThreadOperation(
          db,
          {
            actor: f.actor,
            threadId: f.threadId,
            operation: { kind: "move", destinationPath: "Archiv" },
          },
          f.signal,
          f.deps,
        ),
      ).toMatchObject({ ok: true });
      expect(f.server.state.folders.get("INBOX")?.messages.map((m) => m.uid)).toEqual([1]);
      expect(f.server.state.folders.get("Archiv")?.messages).toHaveLength(2);
      expect(
        (
          await db.execute(
            sql`SELECT f.path FROM mail_message_locators l JOIN mail_folders f ON f.id=l.folder_id WHERE l.account_id=${f.accountId} AND l.active=true`,
          )
        ).rows,
      ).toEqual([{ path: "Archiv" }, { path: "Archiv" }]);
      expect(
        (
          await db.execute(
            sql`SELECT provider_locator->>'folderPath' AS path FROM email_message_attachments WHERE account_id=${f.accountId}`,
          )
        ).rows,
      ).toEqual([{ path: "Archiv" }]);
      f.runtime.folderPaths = ["INBOX", "Archiv"];
      expect(
        await runImapSyncJob(db, { accountId: f.accountId, signal: f.signal }, f.deps),
      ).toMatchObject({ ok: true, value: { applied: 0 } });
      expect(
        (
          await db.execute(
            sql`SELECT id FROM email_messages WHERE account_id=${f.accountId} ORDER BY id`,
          )
        ).rows,
      ).toEqual(before);
    } finally {
      await f.server.close();
    }
  });
});

it.each(["no_move", "readonly_target", "guessed_trash"] as const)(
  "refuses unsupported remote changes before any MOVE (%s)",
  async (kind) => {
    await withTestDb(async (db) => {
      const f = await imapOperationsFixture(db);
      try {
        if (kind === "no_move") f.server.state.move = false;
        const target = f.server.state.folders.get(kind === "guessed_trash" ? "Trash" : "Archiv");
        if (target === undefined) throw new Error("Missing target");
        if (kind === "readonly_target") target.readOnly = true;
        if (kind === "guessed_trash") target.specialUse = null;
        const operation =
          kind === "guessed_trash"
            ? { kind: "trash" as const }
            : { kind: "move" as const, destinationPath: "Archiv" };
        expect(
          await runImapThreadOperation(
            db,
            { actor: f.actor, threadId: f.threadId, operation },
            f.signal,
            f.deps,
          ),
        ).toMatchObject({ ok: false, error: { id: "E_MAIL_006" } });
        expect(f.server.state.commands).not.toContain("MOVE");
        expect(
          (await db.execute(sql`SELECT trashed_at FROM email_threads WHERE id=${f.threadId}`)).rows,
        ).toEqual([{ trashed_at: null }]);
      } finally {
        await f.server.close();
      }
    });
  },
);
