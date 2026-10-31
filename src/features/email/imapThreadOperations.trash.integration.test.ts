import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import { runImapThreadOperation } from "./imapThreadOperations";
import { imapOperationsFixture } from "./imapThreadOperations.test-helpers";

it("moves tracked copies to authoritative Trash and persists explicit retained-history intent", async () => {
  await withTestDb(async (db) => {
    const f = await imapOperationsFixture(db);
    try {
      expect(
        await runImapThreadOperation(
          db,
          { actor: f.actor, threadId: f.threadId, operation: { kind: "trash" } },
          f.signal,
          f.deps,
        ),
      ).toMatchObject({ ok: true });
      expect(f.server.state.folders.get("Trash")?.messages).toHaveLength(2);
      expect(f.server.state.commands).not.toContain("EXPUNGE");
      const [thread] = (
        await db.execute(
          sql`SELECT trashed_at,remote_trashed_at FROM email_threads WHERE id=${f.threadId}`,
        )
      ).rows;
      expect(thread?.trashed_at).not.toBeNull();
      expect(thread?.remote_trashed_at).not.toBeNull();
      expect(
        (await db.execute(sql`SELECT id FROM email_messages WHERE account_id=${f.accountId}`)).rows,
      ).toHaveLength(2);
      expect(
        (
          await db.execute(
            sql`SELECT id FROM mail_message_locators WHERE account_id=${f.accountId} AND active=true`,
          )
        ).rows,
      ).toHaveLength(0);
    } finally {
      await f.server.close();
    }
  });
});
