import { sql } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
import { ok } from "@/types/result";
import { imapOperationsFixture } from "./imapThreadOperations.test-helpers";
import type { ImapThreadOperationDeps } from "./imapThreadOperationsTypes";
import {
  privateLocalReadFixture,
  privateLocalReadMailbox,
  privateLocalReadRemote,
  privateLocalReadRows,
} from "./privateIntakeLocalRead.test-helpers";
import { markThreadRead, markThreadUnread } from "./readState";
import { hydrateOwner } from "./syncCursor";

it.each([false, true])(
  "lets the current private-intake owner change only local read state (administrator=%s)",
  async (admin) => {
    await withTestDb(async (db) => {
      const f = await privateLocalReadFixture(db, admin);
      try {
        const before = await privateLocalReadMailbox(db, f);
        const remote = privateLocalReadRemote(f);
        const args = { actor: f.actor, threadId: f.threadId };
        const deps = { loadConnection: f.loadConnection };
        expect(await privateLocalReadRows(db, f)).toEqual([]);
        expect
          .soft(await markThreadRead(db, args, f.args.signal, deps))
          .toEqual(ok({ threadId: f.threadId }));
        const reads = await privateLocalReadRows(db, f);
        expect.soft(reads).toHaveLength(1);
        expect.soft(reads[0]).toMatchObject({ thread_id: f.threadId, user_id: f.owner.id });
        expect.soft(reads[0]?.read_at).toBeInstanceOf(Date);
        const visible = await db.execute(sql`SELECT r.read_at>=t.last_message_at AS current
          FROM email_thread_reads r JOIN email_threads t ON t.id=r.thread_id
          WHERE r.thread_id=${f.threadId} AND r.user_id=${f.owner.id}`);
        expect.soft(visible.rows).toEqual([{ current: true }]);
        expect
          .soft(await markThreadUnread(db, args, f.args.signal, deps))
          .toEqual(ok({ threadId: f.threadId }));
        expect.soft(await privateLocalReadRows(db, f)).toEqual([]);
        expect.soft(f.loadConnection).not.toHaveBeenCalled();
        expect.soft(f.append).not.toHaveBeenCalled();
        expect.soft(privateLocalReadRemote(f)).toEqual(remote);
        expect(await privateLocalReadMailbox(db, f)).toEqual(before);
      } finally {
        await f.close();
      }
    });
  },
);

it.each([false, true])(
  "keeps a valid private held copy hidden from a foreign reader (administrator=%s)",
  async (admin) => {
    await withTestDb(async (db) => {
      const f = await privateLocalReadFixture(db);
      try {
        const foreign = await seedUser(db, { isAdmin: admin });
        const actor = await hydrateOwner(db, foreign.id, f.args.signal);
        if (!actor.ok) throw actor.error;
        const before = await privateLocalReadMailbox(db, f);
        const reads = await privateLocalReadRows(db, f);
        const remote = privateLocalReadRemote(f);
        for (const change of [markThreadRead, markThreadUnread])
          expect(
            await change(db, { actor: actor.value, threadId: f.threadId }, f.args.signal, {
              loadConnection: f.loadConnection,
            }),
          ).toMatchObject({ ok: false, error: { id: "E_GMAIL_011" } });
        expect(f.loadConnection).not.toHaveBeenCalled();
        expect(f.append).not.toHaveBeenCalled();
        expect(privateLocalReadRemote(f)).toEqual(remote);
        expect(await privateLocalReadRows(db, f)).toEqual(reads);
        expect(await privateLocalReadMailbox(db, f)).toEqual(before);
      } finally {
        await f.close();
      }
    });
  },
);

it.each(["inactive", "invited", "transferred"] as const)(
  "rejects a cached owner's local read authority after becoming %s",
  async (reason) => {
    await withTestDb(async (db) => {
      const f = await privateLocalReadFixture(db);
      try {
        // The owner had a local preference before authority changed. Neither
        // direction may rewrite or remove it using the cached actor afterward.
        await db.execute(sql`INSERT INTO email_thread_reads (thread_id,user_id,read_at)
          SELECT id,${f.owner.id},GREATEST(clock_timestamp(),last_message_at)
          FROM email_threads WHERE id=${f.threadId}`);
        if (reason === "inactive")
          await db.execute(sql`UPDATE users SET is_active=false WHERE id=${f.owner.id}`);
        else if (reason === "invited")
          await db.execute(sql`UPDATE users SET invited_at=now() WHERE id=${f.owner.id}`);
        else {
          const successor = await seedUser(db);
          await db.execute(sql`UPDATE email_accounts SET user_id=${successor.id}
            WHERE id=${f.accountId}`);
        }
        const before = await privateLocalReadMailbox(db, f);
        const reads = await privateLocalReadRows(db, f);
        const remote = privateLocalReadRemote(f);
        for (const change of [markThreadRead, markThreadUnread])
          expect(
            await change(db, { actor: f.actor, threadId: f.threadId }, f.args.signal, {
              loadConnection: f.loadConnection,
            }),
          ).toMatchObject({ ok: false, error: { id: "E_GMAIL_011" } });
        expect(f.loadConnection).not.toHaveBeenCalled();
        expect(f.append).not.toHaveBeenCalled();
        expect(privateLocalReadRemote(f)).toEqual(remote);
        expect(await privateLocalReadRows(db, f)).toEqual(reads);
        expect(await privateLocalReadMailbox(db, f)).toEqual(before);
      } finally {
        await f.close();
      }
    });
  },
);

it("keeps ordinary owner IMAP read and unread on the actual remote STORE path", async () => {
  await withTestDb(async (db) => {
    const f = await imapOperationsFixture(db);
    const loadConnection = vi.fn<NonNullable<ImapThreadOperationDeps["loadConnection"]>>(() =>
      Promise.resolve(ok(f.runtime)),
    );
    try {
      const args = { actor: f.actor, threadId: f.threadId };
      for (const read of [true, false]) {
        const priorStores = f.server.state.commands.filter((command) => command === "STORE").length;
        const change = read ? markThreadRead : markThreadUnread;
        expect(await change(db, args, f.signal, { loadConnection })).toEqual(
          ok({ threadId: f.threadId }),
        );
        expect(
          f.server.state.commands.filter((command) => command === "STORE").length,
        ).toBeGreaterThan(priorStores);
        const messages = f.server.state.folders.get("INBOX")?.messages.filter((m) => m.uid > 1);
        expect(messages).toHaveLength(2);
        expect(messages?.every((m) => m.flags.includes("\\Seen") === read)).toBe(true);
        const markers = await db.execute(sql`SELECT thread_id FROM email_thread_reads
          WHERE thread_id=${f.threadId} AND user_id=${f.owner.id}`);
        expect(markers.rows).toHaveLength(read ? 1 : 0);
      }
      expect(loadConnection).toHaveBeenCalledTimes(2);
    } finally {
      await f.server.close();
    }
  });
});
