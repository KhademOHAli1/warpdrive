import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import { runImapSyncJob } from "./imapSync";
import { runImapThreadOperation } from "./imapThreadOperations";
import { imapOperationsFixture } from "./imapThreadOperations.test-helpers";

it("returns unknown when real remote flags succeed but the PostgreSQL persistence transaction fails", async () => {
  await withTestDb(async (db) => {
    const f = await imapOperationsFixture(db);
    try {
      await db.execute(
        sql`CREATE FUNCTION fail_locator_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic persistence failure'; END $$`,
      );
      await db.execute(
        sql`CREATE TRIGGER synthetic_locator_failure BEFORE UPDATE ON mail_message_locators FOR EACH ROW EXECUTE FUNCTION fail_locator_update()`,
      );
      await expect(
        runImapThreadOperation(
          db,
          { actor: f.actor, threadId: f.threadId, operation: { kind: "read", read: true } },
          f.signal,
          f.deps,
        ),
      ).resolves.toMatchObject({ ok: false, error: { id: "E_MAIL_008" } });
      expect(
        f.server.state.folders
          .get("INBOX")
          ?.messages.filter((m) => m.uid > 1)
          .every((m) => m.flags.includes("\\Seen")),
      ).toBe(true);
    } finally {
      await f.server.close();
    }
  });
});

it.each(["STORE", "MOVE"] as const)(
  "does not claim a confirmed update after a lost native %s acknowledgment",
  async (command) => {
    await withTestDb(async (db) => {
      const f = await imapOperationsFixture(db);
      try {
        f.server.state.dropMutationResponse = command;
        const operation =
          command === "STORE"
            ? { kind: "read" as const, read: true }
            : { kind: "move" as const, destinationPath: "Archiv" };
        expect(
          await runImapThreadOperation(
            db,
            { actor: f.actor, threadId: f.threadId, operation },
            f.signal,
            f.deps,
          ),
        ).toMatchObject({ ok: false, error: { id: "E_MAIL_008" } });
        expect(
          (
            await db.execute(
              sql`SELECT id FROM mail_message_locators WHERE account_id=${f.accountId} AND active=true`,
            )
          ).rows,
        ).toHaveLength(2);
        if (command === "MOVE")
          expect(f.server.state.folders.get("Archiv")?.messages).toHaveLength(2);
      } finally {
        await f.server.close();
      }
    });
  },
);

it("does not guess destination UIDs when UIDPLUS proof is unavailable and reconciles by exact content later", async () => {
  await withTestDb(async (db) => {
    const f = await imapOperationsFixture(db);
    try {
      f.runtime.folderPaths = ["INBOX", "Archiv"];
      f.server.state.omitCopyUid = true;
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
      ).toMatchObject({ ok: true, value: { requiresResync: true } });
      expect(
        (
          await db.execute(
            sql`SELECT id FROM mail_message_locators WHERE account_id=${f.accountId} AND active=true`,
          )
        ).rows,
      ).toHaveLength(0);
      expect(
        await runImapSyncJob(db, { accountId: f.accountId, signal: f.signal }, f.deps),
      ).toMatchObject({ ok: true, value: { applied: 0 } });
      expect(
        (await db.execute(sql`SELECT id FROM email_messages WHERE account_id=${f.accountId}`)).rows,
      ).toHaveLength(2);
      expect(
        (
          await db.execute(
            sql`SELECT id FROM mail_message_locators WHERE account_id=${f.accountId} AND active=true`,
          )
        ).rows,
      ).toHaveLength(2);
    } finally {
      await f.server.close();
    }
  });
});

it.each(["disconnect", "invite"] as const)(
  "fences changed authority after authentication before STORE (%s)",
  async (change) => {
    await withTestDb(async (db) => {
      const f = await imapOperationsFixture(db);
      try {
        const real = f.runtime.imap.setFlags.bind(f.runtime.imap);
        f.runtime.imap.setFlags = (args) =>
          real({
            ...args,
            beforeMutation: async (signal) => {
              if (change === "disconnect")
                await db.execute(
                  sql`UPDATE email_accounts SET status='disconnected',connection_generation=2 WHERE id=${f.accountId}`,
                );
              else await db.execute(sql`UPDATE users SET invited_at=now() WHERE id=${f.owner.id}`);
              return (await args.beforeMutation?.(signal)) ?? true;
            },
          });
        expect(
          await runImapThreadOperation(
            db,
            { actor: f.actor, threadId: f.threadId, operation: { kind: "read", read: true } },
            f.signal,
            f.deps,
          ),
        ).toMatchObject({ ok: false, error: { id: "E_MAIL_007" } });
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
  },
);

it("persists only confirmed chunks when another folder becomes readonly midway", async () => {
  await withTestDb(async (db) => {
    const f = await imapOperationsFixture(db);
    try {
      const inbox = f.server.state.folders.get("INBOX");
      const sent = f.server.state.folders.get("Sent");
      const reply = inbox?.messages[2];
      if (sent === undefined || reply === undefined) throw new Error("Missing copied source");
      sent.messages = [{ ...reply, uid: 1 }];
      f.runtime.folderPaths = ["INBOX", "Sent"];
      await runImapSyncJob(db, { accountId: f.accountId, signal: f.signal }, f.deps);
      f.server.state.afterStore = () => {
        sent.readOnly = true;
      };
      expect(
        await runImapThreadOperation(
          db,
          { actor: f.actor, threadId: f.threadId, operation: { kind: "read", read: true } },
          f.signal,
          f.deps,
        ),
      ).toMatchObject({ ok: false, error: { id: "E_MAIL_009" } });
      const rows = (
        await db.execute(
          sql`SELECT f.path,l.flags FROM mail_message_locators l JOIN mail_folders f ON f.id=l.folder_id WHERE l.account_id=${f.accountId}`,
        )
      ).rows;
      expect(
        rows
          .filter((row) => row.path === "INBOX")
          .every((row) => Array.isArray(row.flags) && row.flags.includes("\\Seen")),
      ).toBe(true);
      expect(rows.find((row) => row.path === "Sent")?.flags).toEqual([]);
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
