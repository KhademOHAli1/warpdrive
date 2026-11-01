import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
import { imapOperationsFixture } from "./imapThreadOperations.test-helpers";
import { markThreadRead, markThreadUnread } from "./readState";

it.each([true, false])(
  "routes owner read state through the remote IMAP flow (read=%s)",
  async (read) => {
    await withTestDb(async (db) => {
      const f = await imapOperationsFixture(db);
      try {
        const result = await (read ? markThreadRead : markThreadUnread)(
          db,
          { actor: f.actor, threadId: f.threadId },
          f.signal,
          f.deps,
        );
        expect(result).toMatchObject({ ok: true });
        expect(
          f.server.state.folders
            .get("INBOX")
            ?.messages.filter((m) => m.uid > 1)
            .every((m) => m.flags.includes("\\Seen") === read),
        ).toBe(true);
      } finally {
        await f.server.close();
      }
    });
  },
);

it("keeps a shared viewer's read marker local without using mailbox credentials", async () => {
  await withTestDb(async (db) => {
    const f = await imapOperationsFixture(db);
    try {
      const viewer = await seedUser(db);
      const [person] = (
        await db.execute(
          sql`INSERT INTO persons (name,owner_id,visibility_level) VALUES ('Synthetic contact',${f.owner.id},'all') RETURNING id`,
        )
      ).rows;
      if (typeof person?.id !== "string") throw new Error("Missing contact fixture");
      await db.execute(
        sql`UPDATE email_threads SET visibility='shared',person_id=${person.id} WHERE id=${f.threadId}`,
      );
      let loaded = false;
      const result = await markThreadRead(
        db,
        { actor: { ...f.actor, id: viewer.id }, threadId: f.threadId },
        f.signal,
        {
          loadConnection: () => {
            loaded = true;
            return Promise.resolve({ ok: true as const, value: f.runtime });
          },
        },
      );
      expect(result).toMatchObject({ ok: true });
      expect(loaded).toBe(false);
      expect(f.server.state.commands).not.toContain("STORE");
      expect(
        (await db.execute(sql`SELECT thread_id FROM email_thread_reads WHERE user_id=${viewer.id}`))
          .rows,
      ).toHaveLength(1);
    } finally {
      await f.server.close();
    }
  });
});
