import { expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import { imapOperationsFixture } from "./imapThreadOperations.test-helpers";
import { trashThread } from "./threadTrash";

it("dispatches a non-Gmail trash through the native IMAP workflow without Gmail credentials", async () => {
  await withTestDb(async (db) => {
    const f = await imapOperationsFixture(db);
    try {
      expect(
        await trashThread(db, { actor: f.actor, threadId: f.threadId }, f.signal, f.deps),
      ).toMatchObject({ ok: true, value: { threadId: f.threadId } });
      expect(f.server.state.folders.get("Trash")?.messages).toHaveLength(2);
    } finally {
      await f.server.close();
    }
  });
});
