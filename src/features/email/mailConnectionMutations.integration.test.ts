import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { withTestDb } from "@/db/testing";
import { ok } from "@/types/result";
import { decryptToken, encryptToken } from "./crypto";
import { listActorMailboxes } from "./mailAccountsRepo";
import { seedMailHttpSession } from "./mailConnectionHttp.test-helpers";
import {
  disconnectMailboxWithNativeSession,
  mutateMailboxConnection,
} from "./mailConnectionMutations";

type Db = Parameters<Parameters<typeof withTestDb>[0]>[0];
const signal = () => AbortSignal.timeout(15_000);
async function mailbox(
  db: Db,
  actorId: string,
  options: { provider?: "gmail" | "imap_smtp"; isDefault?: boolean; address?: string } = {},
) {
  return (
    await db.execute(sql`INSERT INTO email_accounts(user_id,email_address,provider,is_default,refresh_token_enc,credentials_enc)
    VALUES(${actorId},${options.address ?? "mailbox@example.test"},${options.provider ?? "imap_smtp"},${options.isDefault ?? false},${options.provider === "gmail" ? encryptToken("google-refresh-to-revoke") : null},${encryptToken("synthetic-private-mailbox-password")}) RETURNING id`)
  ).rows[0] as { id: string };
}

describe("mail connection mutations", () => {
  it("pauses and resumes idempotently while fencing old jobs", async () => {
    await withTestDb(async (db) => {
      const f = await seedMailHttpSession(db);
      const account = await mailbox(db, f.user.id);
      const enqueueSync = vi.fn(() => Promise.resolve(true));
      const mutate = (action: string) =>
        mutateMailboxConnection(db, f.context, { accountId: account.id, action }, signal(), {
          enqueueSync,
        });
      expect(await mutate("pause")).toEqual(ok(undefined));
      expect(await mutate("pause")).toEqual(ok(undefined));
      expect(
        (
          await db.execute(
            sql`SELECT paused,connection_generation FROM email_accounts WHERE id=${account.id}`,
          )
        ).rows[0],
      ).toEqual({ paused: true, connection_generation: 2 });
      expect(enqueueSync).not.toHaveBeenCalled();
      expect(await mutate("resume")).toEqual(ok(undefined));
      expect(
        (
          await db.execute(
            sql`SELECT paused,connection_generation FROM email_accounts WHERE id=${account.id}`,
          )
        ).rows[0],
      ).toEqual({ paused: false, connection_generation: 3 });
      expect(enqueueSync).toHaveBeenCalledWith(account.id, expect.any(AbortSignal));
    });
  });

  it("cannot resume a disconnected mailbox or claim an unavailable retry was queued", async () => {
    await withTestDb(async (db) => {
      const f = await seedMailHttpSession(db);
      const account = await mailbox(db, f.user.id);
      expect(
        await mutateMailboxConnection(
          db,
          f.context,
          { accountId: account.id, action: "retry" },
          signal(),
          { enqueueSync: null },
        ),
      ).toEqual({ ok: false, error: "network" });
      await db.execute(sql`UPDATE email_accounts SET status='disconnected' WHERE id=${account.id}`);
      expect(
        await mutateMailboxConnection(
          db,
          f.context,
          { accountId: account.id, action: "resume" },
          signal(),
        ),
      ).toEqual({ ok: false, error: "connection_changed" });
    });
  });

  it("atomically queues Google revocation, clears credentials and replaces a disconnected default", async () => {
    await withTestDb(async (db) => {
      const f = await seedMailHttpSession(db);
      const gmail = await mailbox(db, f.user.id, { provider: "gmail", isDefault: true });
      const imap = await mailbox(db, f.user.id, { address: "other@example.test" });
      expect(
        await mutateMailboxConnection(
          db,
          f.context,
          { accountId: gmail.id, action: "disconnect" },
          signal(),
        ),
      ).toEqual(ok(undefined));
      const row = (
        await db.execute(
          sql`SELECT status,refresh_token_enc,credentials_enc,connection_generation,credential_version,is_default FROM email_accounts WHERE id=${gmail.id}`,
        )
      ).rows[0];
      expect(row).toEqual({
        status: "disconnected",
        refresh_token_enc: null,
        credentials_enc: null,
        connection_generation: 2,
        credential_version: 2,
        is_default: false,
      });
      const revocations = (
        await db.execute(
          sql`SELECT id,provider,token_enc FROM auth_integration_revocations WHERE user_id=${f.user.id}`,
        )
      ).rows as { id: string; provider: string; token_enc: Buffer }[];
      expect(revocations).toHaveLength(1);
      expect(revocations[0]?.provider).toBe("google");
      expect(decryptToken(revocations[0]!.token_enc)).toEqual(ok("google-refresh-to-revoke"));
      const views = await listActorMailboxes(db, f.user.id, signal());
      expect(views.find((view) => view.id === gmail.id)?.remoteRevocationStatus).toBe("pending");
      expect(views.find((view) => view.id === imap.id)?.isDefault).toBe(true);
      await db.execute(
        sql`UPDATE auth_integration_revocations SET status='revoked',token_enc=NULL WHERE id=${revocations[0]!.id}`,
      );
      expect(
        (await listActorMailboxes(db, f.user.id, signal())).find((view) => view.id === gmail.id)
          ?.remoteRevocationStatus,
      ).toBe("complete");
    });
  });

  it("rolls back a disconnect if recording provider revocation fails", async () => {
    await withTestDb(async (db) => {
      const f = await seedMailHttpSession(db);
      const account = await mailbox(db, f.user.id, { provider: "gmail", isDefault: true });
      await db.execute(
        sql`CREATE FUNCTION reject_mail_revoke() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'controlled revocation failure'; END $$`,
      );
      await db.execute(
        sql`CREATE TRIGGER reject_mail_revoke BEFORE INSERT ON auth_integration_revocations FOR EACH ROW EXECUTE FUNCTION reject_mail_revoke()`,
      );
      await expect(
        mutateMailboxConnection(
          db,
          f.context,
          { accountId: account.id, action: "disconnect" },
          signal(),
        ),
      ).rejects.toThrow();
      const row = (
        await db.execute(
          sql`SELECT status,connection_generation,refresh_token_enc IS NOT NULL AS retained,is_default FROM email_accounts WHERE id=${account.id}`,
        )
      ).rows[0];
      expect(row).toEqual({
        status: "connected",
        connection_generation: 1,
        retained: true,
        is_default: true,
      });
    });
  });

  it("keeps nonsecret reconnect settings while excluding arbitrary JSON properties", async () => {
    await withTestDb(async (db) => {
      const f = await seedMailHttpSession(db);
      const account = await mailbox(db, f.user.id);
      const endpoint = {
        host: "mail.example.test",
        port: 993,
        security: "tls",
        username: "owner",
        password: "must-never-be-in-the-view",
      };
      await db.execute(sql`UPDATE email_accounts SET history_days=30,folder_paths='["INBOX","Sent"]'::jsonb,
        connection_settings=${JSON.stringify({ imap: endpoint, smtp: { ...endpoint, port: 465 }, sentCopyMode: "append", sentFolderPath: "Sent", privateExtra: "must-never-be-in-the-view" })}::jsonb WHERE id=${account.id}`);
      const view = (await listActorMailboxes(db, f.user.id, signal()))[0];
      expect(view).toMatchObject({
        historyDays: 30,
        folderPaths: ["INBOX", "Sent"],
        sentCopyMode: "append",
        sentFolderPath: "Sent",
        configuration: {
          imap: { host: "mail.example.test", port: 993, security: "tls", username: "owner" },
          smtp: { host: "mail.example.test", port: 465, security: "tls", username: "owner" },
        },
      });
      expect(JSON.stringify(view)).not.toContain("must-never-be-in-the-view");
      expect(JSON.stringify(view)).not.toMatch(/password|credentials|token/i);
    });
  });

  it("shows error connections as paused when their worker is paused", async () => {
    await withTestDb(async (db) => {
      const f = await seedMailHttpSession(db);
      const account = await mailbox(db, f.user.id);
      await db.execute(
        sql`UPDATE email_accounts SET status='error',paused=true WHERE id=${account.id}`,
      );
      expect((await listActorMailboxes(db, f.user.id, signal()))[0]?.status).toBe("paused");
    });
  });
});

it("projects legacy and folder failures as finite UI errors without raw diagnostics", async () => {
  await withTestDb(async (db) => {
    const f = await seedMailHttpSession(db);
    const account = await mailbox(db, f.user.id);
    await db.execute(
      sql`UPDATE email_accounts SET last_error_id='E_GMAIL_001' WHERE id=${account.id}`,
    );
    expect((await listActorMailboxes(db, f.user.id, signal()))[0]).toMatchObject({
      status: "error",
      errorCode: "network",
    });
    await db.execute(sql`UPDATE email_accounts SET last_error_id=NULL WHERE id=${account.id}`);
    await db.execute(
      sql`INSERT INTO mail_folders(account_id,path,last_error_kind) VALUES(${account.id},'INBOX','authentication')`,
    );
    expect((await listActorMailboxes(db, f.user.id, signal()))[0]).toMatchObject({
      status: "error",
      errorCode: "authentication",
    });
    await db.execute(
      sql`UPDATE mail_folders SET last_error_kind='sensitive-server-diagnostic' WHERE account_id=${account.id}`,
    );
    const view = (await listActorMailboxes(db, f.user.id, signal()))[0];
    expect(view).toMatchObject({ status: "error", errorCode: "unknown" });
    expect(JSON.stringify(view)).not.toContain("sensitive-server-diagnostic");
  });
});

it("the legacy native-session adapter denies stale identity confirmation", async () => {
  await withTestDb(async (db) => {
    const f = await seedMailHttpSession(db, { freshAt: new Date(Date.now() - 600_000) });
    const account = await mailbox(db, f.user.id);
    expect(await disconnectMailboxWithNativeSession(db, f.headers, account.id, signal())).toEqual({
      ok: false,
      error: "fresh_auth_required",
    });
    expect(
      (
        await db.execute(
          sql`SELECT status,connection_generation FROM email_accounts WHERE id=${account.id}`,
        )
      ).rows[0],
    ).toEqual({ status: "connected", connection_generation: 1 });
  });
});

it("the legacy native-session adapter uses the same audited disconnect workflow", async () => {
  await withTestDb(async (db) => {
    const f = await seedMailHttpSession(db);
    const account = await mailbox(db, f.user.id);
    expect(await disconnectMailboxWithNativeSession(db, f.headers, account.id, signal())).toEqual(
      ok(undefined),
    );
    expect((await listActorMailboxes(db, f.user.id, signal()))[0]?.remoteRevocationStatus).toBe(
      "manual",
    );
    expect(
      (await db.execute(sql`SELECT action FROM auth_security_events WHERE actor_id=${f.user.id}`))
        .rows,
    ).toContainEqual({ action: "mailbox.disconnect" });
  });
});

it("never indexes inherited object properties as UI error codes", async () => {
  await withTestDb(async (db) => {
    const f = await seedMailHttpSession(db);
    const account = await mailbox(db, f.user.id);
    await db.execute(
      sql`UPDATE email_accounts SET last_error_id='__proto__' WHERE id=${account.id}`,
    );
    expect((await listActorMailboxes(db, f.user.id, signal()))[0]).toMatchObject({
      status: "error",
      errorCode: "unknown",
    });
  });
});
