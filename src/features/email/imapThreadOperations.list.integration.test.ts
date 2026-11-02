import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import { imapOperationsFixture } from "./imapThreadOperations.test-helpers";
import { listImapMoveFolders } from "./imapThreadOperationsList";

it("offers actual selectable folders without exposing special-use Trash or credentials", async () => {
  await withTestDb(async (db) => {
    const f = await imapOperationsFixture(db);
    try {
      const result = await listImapMoveFolders(
        db,
        { actor: f.actor, threadId: f.threadId },
        f.signal,
        f.deps,
      );
      expect(result).toMatchObject({
        ok: true,
        value: {
          folders: expect.arrayContaining([
            { path: "Archiv", name: "Archiv", readOnly: null, selected: false },
          ]),
        },
      });
      if (result.ok)
        expect(result.value.folders.some((folder) => folder.path === "Trash")).toBe(false);
      expect(JSON.stringify(result)).not.toContain("synthetic-password");
    } finally {
      await f.server.close();
    }
  });
});

it("returns no private folder names after a disconnect during LIST", async () => {
  await withTestDb(async (db) => {
    const f = await imapOperationsFixture(db);
    try {
      const real = f.runtime.imap.listFolders.bind(f.runtime.imap);
      f.runtime.imap.listFolders = async (args) => {
        const result = await real(args);
        await db.execute(
          sql`UPDATE email_accounts SET status='disconnected',connection_generation=2 WHERE id=${f.accountId}`,
        );
        return result;
      };
      expect(
        await listImapMoveFolders(db, { actor: f.actor, threadId: f.threadId }, f.signal, f.deps),
      ).toMatchObject({ ok: false, error: { id: "E_MAIL_007" } });
    } finally {
      await f.server.close();
    }
  });
});
