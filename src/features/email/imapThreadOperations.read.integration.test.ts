import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
import { runImapThreadOperation } from "./imapThreadOperations";
import { imapOperationsFixture } from "./imapThreadOperations.test-helpers";

it.each([true, false])(
  "sets owner remote Seen flags and CRM read state together (read=%s)",
  async (read) => {
    await withTestDb(async (db) => {
      const f = await imapOperationsFixture(db);
      try {
        expect(
          await runImapThreadOperation(
            db,
            { actor: f.actor, threadId: f.threadId, operation: { kind: "read", read } },
            f.signal,
            f.deps,
          ),
        ).toMatchObject({ ok: true, value: { threadId: f.threadId } });
        const active = f.server.state.folders.get("INBOX")?.messages.filter((m) => m.uid > 1) ?? [];
        expect(active).toHaveLength(2);
        expect(active.every((m) => m.flags.includes("\\Seen") === read)).toBe(true);
        const locators = (
          await db.execute(
            sql`SELECT flags,last_seen_at FROM mail_message_locators WHERE account_id=${f.accountId}`,
          )
        ).rows;
        expect(
          locators.every(
            (row) => Array.isArray(row.flags) && row.flags.includes("\\Seen") === read,
          ),
        ).toBe(true);
        const reads = (
          await db.execute(
            sql`SELECT thread_id FROM email_thread_reads WHERE user_id=${f.owner.id}`,
          )
        ).rows;
        expect(reads).toHaveLength(read ? 1 : 0);
      } finally {
        await f.server.close();
      }
    });
  },
);

it("refuses readonly source folders before changing local read state", async () => {
  await withTestDb(async (db) => {
    const f = await imapOperationsFixture(db);
    try {
      const inbox = f.server.state.folders.get("INBOX");
      if (inbox !== undefined) inbox.readOnly = true;
      expect(
        await runImapThreadOperation(
          db,
          { actor: f.actor, threadId: f.threadId, operation: { kind: "read", read: true } },
          f.signal,
          f.deps,
        ),
      ).toMatchObject({ ok: false, error: { id: "E_MAIL_006" } });
      expect(f.server.state.commands).not.toContain("STORE");
      expect(
        (
          await db.execute(
            sql`SELECT thread_id FROM email_thread_reads WHERE user_id=${f.owner.id}`,
          )
        ).rows,
      ).toHaveLength(0);
    } finally {
      await f.server.close();
    }
  });
});

it("never loads credentials or mutates another person's mailbox", async () => {
  await withTestDb(async (db) => {
    const f = await imapOperationsFixture(db);
    try {
      const stranger = await seedUser(db);
      let loaded = false;
      const result = await runImapThreadOperation(
        db,
        {
          actor: { ...f.actor, id: stranger.id, type: "admin" },
          threadId: f.threadId,
          operation: { kind: "read", read: true },
        },
        f.signal,
        {
          loadConnection: () => {
            loaded = true;
            return Promise.resolve({ ok: true as const, value: f.runtime });
          },
        },
      );
      expect(result).toMatchObject({ ok: false, error: { id: "E_GMAIL_011" } });
      expect(loaded).toBe(false);
    } finally {
      await f.server.close();
    }
  });
});
