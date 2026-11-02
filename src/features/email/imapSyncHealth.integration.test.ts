import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
import { err } from "@/types/result";
import { runImapSyncJob } from "./imapSync";
import { IMAP_SYNC_NOW, imapSyncFixture } from "./imapSync.test-helpers";
import { recordImapSyncFailure, retireImapSyncFailure } from "./imapSyncHealth";
import { listActorMailboxes } from "./mailAccountsRepo";
import { createImapTransport } from "./providers/imap";

const signal = () => AbortSignal.timeout(30_000);

it("surfaces real TLS authentication failure before folder discovery and recovers without duplicate history", async () => {
  await withTestDb(async (db) => {
    const f = await imapSyncFixture(db);
    try {
      const args = { accountId: f.accountId, now: IMAP_SYNC_NOW, signal: signal() };
      expect((await runImapSyncJob(db, args, f.deps)).ok).toBe(true);
      const before = (
        await db.execute(sql`SELECT id,thread_id,message_fingerprint FROM email_messages
        WHERE account_id=${f.accountId} ORDER BY id`)
      ).rows;
      const transport = f.runtime.imap;
      f.runtime.imap = createImapTransport({
        endpoint: f.server.endpoint,
        username: "owner@mail.test",
        password: "changed-synthetic-password",
      });
      await db.execute(
        sql`UPDATE mail_folders SET last_error_kind='network' WHERE account_id=${f.accountId}`,
      );
      expect((await runImapSyncJob(db, args, f.deps)).ok).toBe(false);
      const failed = (await listActorMailboxes(db, f.owner.id, signal()))[0];
      expect(failed).toMatchObject({ status: "error", errorCode: "authentication" });
      expect(
        (
          await db.execute(sql`SELECT status,last_error_id FROM email_accounts
        WHERE id=${f.accountId}`)
        ).rows[0],
      ).toEqual({
        status: "connected",
        last_error_id: "E_IMAP_SYNC_AUTHENTICATION",
      });
      expect(JSON.stringify(failed)).not.toContain("changed-synthetic-password");
      expect(
        (
          await db.execute(sql`SELECT id,thread_id,message_fingerprint FROM email_messages
        WHERE account_id=${f.accountId} ORDER BY id`)
        ).rows,
      ).toEqual(before);
      f.runtime.imap = transport;
      expect(await runImapSyncJob(db, args, f.deps)).toMatchObject({
        ok: true,
        value: { applied: 0 },
      });
      expect((await listActorMailboxes(db, f.owner.id, signal()))[0]).toMatchObject({
        status: "connected",
      });
      expect(
        (
          await db.execute(sql`SELECT id,thread_id,message_fingerprint FROM email_messages
        WHERE account_id=${f.accountId} ORDER BY id`)
        ).rows,
      ).toEqual(before);
    } finally {
      await f.server.close();
    }
  });
});

it.each(["reconfigured", "paused", "disconnected", "new_owner", "inactive_owner"] as const)(
  "never stamps an old LIST failure after the mailbox becomes %s",
  async (change) => {
    await withTestDb(async (db) => {
      const f = await imapSyncFixture(db);
      try {
        f.runtime.imap.listFolders = async () => {
          if (change === "reconfigured")
            await db.execute(
              sql`UPDATE email_accounts SET connection_generation=connection_generation+1 WHERE id=${f.accountId}`,
            );
          if (change === "paused")
            await db.execute(sql`UPDATE email_accounts SET paused=true WHERE id=${f.accountId}`);
          if (change === "disconnected")
            await db.execute(
              sql`UPDATE email_accounts SET status='disconnected' WHERE id=${f.accountId}`,
            );
          if (change === "new_owner") {
            const next = await seedUser(db);
            await db.execute(
              sql`UPDATE email_accounts SET user_id=${next.id} WHERE id=${f.accountId}`,
            );
          }
          if (change === "inactive_owner")
            await db.execute(sql`UPDATE users SET is_active=false WHERE id=${f.owner.id}`);
          return err({ kind: "authentication" as const });
        };
        expect(
          (await runImapSyncJob(db, { accountId: f.accountId, signal: signal() }, f.deps)).ok,
        ).toBe(false);
        expect(
          (await db.execute(sql`SELECT last_error_id FROM email_accounts WHERE id=${f.accountId}`))
            .rows[0],
        ).toEqual({ last_error_id: null });
        await db.execute(sql`UPDATE email_accounts SET last_error_id='E_IMAP_SYNC_TLS'
          WHERE id=${f.accountId}`);
        await retireImapSyncFailure(db, f.runtime, signal());
        expect(
          (await db.execute(sql`SELECT last_error_id FROM email_accounts WHERE id=${f.accountId}`))
            .rows[0],
        ).toEqual({ last_error_id: "E_IMAP_SYNC_TLS" });
      } finally {
        await f.server.close();
      }
    });
  },
);

it("retires a recovered LIST error before showing a fresh folder TLS failure", async () => {
  await withTestDb(async (db) => {
    const f = await imapSyncFixture(db);
    try {
      const args = { accountId: f.accountId, now: IMAP_SYNC_NOW, signal: signal() };
      expect((await runImapSyncJob(db, args, f.deps)).ok).toBe(true);
      const transport = f.runtime.imap;
      f.runtime.imap = createImapTransport({
        endpoint: f.server.endpoint,
        username: "owner@mail.test",
        password: "changed-synthetic-password",
      });
      expect((await runImapSyncJob(db, args, f.deps)).ok).toBe(false);
      expect((await listActorMailboxes(db, f.owner.id, signal()))[0]?.errorCode).toBe(
        "authentication",
      );
      f.runtime.imap = transport;
      // Actual native LIST recovers; inject the next domain boundary's failure.
      f.runtime.imap.inspectFolder = () => Promise.resolve(err({ kind: "tls" as const }));
      expect((await runImapSyncJob(db, args, f.deps)).ok).toBe(false);
      expect((await listActorMailboxes(db, f.owner.id, signal()))[0]).toMatchObject({
        status: "error",
        errorCode: "tls",
      });
      expect(
        (
          await db.execute(sql`SELECT last_error_id FROM email_accounts
        WHERE id=${f.accountId}`)
        ).rows[0],
      ).toEqual({ last_error_id: null });
      expect(
        (
          await db.execute(sql`SELECT last_error_kind FROM mail_folders
        WHERE account_id=${f.accountId} AND path='INBOX'`)
        ).rows[0],
      ).toEqual({ last_error_kind: "tls" });
    } finally {
      await f.server.close();
    }
  });
});

it("retires only its own LIST error after no-page recovery without claiming sync progress", async () => {
  await withTestDb(async (db) => {
    const f = await imapSyncFixture(db, ["Trash"]);
    try {
      f.server.state.folders.set("Trash", {
        validity: "789",
        readOnly: false,
        messages: [],
        specialUse: "\\Trash",
      });
      const args = { accountId: f.accountId, now: IMAP_SYNC_NOW, signal: signal() };
      const transport = f.runtime.imap;
      f.runtime.imap = createImapTransport({
        endpoint: f.server.endpoint,
        username: "owner@mail.test",
        password: "changed-synthetic-password",
      });
      expect((await runImapSyncJob(db, args, f.deps)).ok).toBe(false);
      await db.execute(sql`INSERT INTO mail_folders(account_id,path,last_error_kind)
        VALUES(${f.accountId},'Retained','tls')`);
      f.runtime.imap = transport;
      expect(await runImapSyncJob(db, args, f.deps)).toMatchObject({
        ok: true,
        value: { applied: 0, skipped: 0, more: false },
      });
      expect(
        (
          await db.execute(sql`SELECT last_error_id,last_sync_at FROM email_accounts
        WHERE id=${f.accountId}`)
        ).rows[0],
      ).toEqual({ last_error_id: null, last_sync_at: null });
      expect(
        (
          await db.execute(sql`SELECT last_error_kind FROM mail_folders
        WHERE account_id=${f.accountId} AND path='Retained'`)
        ).rows[0],
      ).toEqual({ last_error_kind: "tls" });
      await db.execute(sql`UPDATE email_accounts SET last_error_id='E_MAIL_001'
        WHERE id=${f.accountId}`);
      expect((await runImapSyncJob(db, args, f.deps)).ok).toBe(true);
      expect(
        (
          await db.execute(sql`SELECT last_error_id,last_sync_at FROM email_accounts
        WHERE id=${f.accountId}`)
        ).rows[0],
      ).toEqual({ last_error_id: "E_MAIL_001", last_sync_at: null });
    } finally {
      await f.server.close();
    }
  });
});

it("retains a removed folder's error without presenting it as current mailbox failure", async () => {
  await withTestDb(async (db) => {
    const owner = await seedUser(db);
    const accountId = randomUUID();
    await db.execute(sql`INSERT INTO email_accounts(id,user_id,email_address,provider,folder_paths)
      VALUES(${accountId},${owner.id},'selected@mail.test','imap_smtp','["INBOX"]'::jsonb)`);
    await db.execute(sql`INSERT INTO mail_folders(account_id,path,last_error_kind,updated_at) VALUES
      (${accountId},'INBOX','tls',now()-interval '1 minute'),
      (${accountId},'Removed','authentication',now())`);
    expect((await listActorMailboxes(db, owner.id, signal()))[0]).toMatchObject({
      status: "error",
      errorCode: "tls",
    });
    await db.execute(
      sql`UPDATE mail_folders SET last_error_kind=NULL WHERE account_id=${accountId} AND path='INBOX'`,
    );
    const recovered = (await listActorMailboxes(db, owner.id, signal()))[0];
    expect(recovered?.status).toBe("connected");
    expect(recovered?.errorCode).toBeUndefined();
    expect(
      (
        await db.execute(sql`SELECT last_error_kind FROM mail_folders
      WHERE account_id=${accountId} AND path='Removed'`)
      ).rows[0],
    ).toEqual({ last_error_kind: "authentication" });
  });
});

it("stores only a fixed unknown classification for an unexpected failure kind", async () => {
  await withTestDb(async (db) => {
    const owner = await seedUser(db);
    const accountId = randomUUID();
    await db.execute(sql`INSERT INTO email_accounts(id,user_id,email_address,provider)
      VALUES(${accountId},${owner.id},'safe@mail.test','imap_smtp')`);
    await recordImapSyncFailure(
      db,
      { accountId, ownerId: owner.id, generation: 1 },
      "credential=synthetic-do-not-store",
      signal(),
    );
    expect(
      (await db.execute(sql`SELECT last_error_id FROM email_accounts WHERE id=${accountId}`))
        .rows[0],
    ).toEqual({ last_error_id: "E_IMAP_SYNC_UNKNOWN" });
    expect((await listActorMailboxes(db, owner.id, signal()))[0]).toMatchObject({
      status: "error",
      errorCode: "unknown",
    });
  });
});
