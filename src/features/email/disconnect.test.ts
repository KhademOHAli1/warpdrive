import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
import { ok } from "@/types/result";
import { decryptToken, encryptToken } from "./crypto";
import { softDisconnectMailbox } from "./disconnect";
import { seedMailHttpSession } from "./mailConnectionHttp.test-helpers";
import { exchangeAndBind } from "./oauth";

async function seedConnectedAccount(
  db: Parameters<typeof seedUser>[0],
  userId: string,
  email: string,
): Promise<string> {
  const r = await db.execute(sql`
    INSERT INTO email_accounts (user_id, email_address, refresh_token_enc, status)
    VALUES (${userId}, ${email}, decode('deadbeef', 'hex'), 'connected')
    RETURNING id
  `);
  return (r.rows[0] as { id: string }).id;
}

describe("softDisconnectMailbox", () => {
  it("sets status=disconnected, nulls the refresh token, and clears the error id", async () => {
    await withTestDb(async (db) => {
      const u = await seedUser(db);
      const id = await seedConnectedAccount(db, u.id, "rep@example.com");
      await softDisconnectMailbox(db, id, new AbortController().signal);
      const row = (
        await db.execute(sql`
          SELECT status, refresh_token_enc, last_error_id FROM email_accounts WHERE id=${id}
        `)
      ).rows[0] as {
        status: string;
        refresh_token_enc: Buffer | null;
        last_error_id: string | null;
      };
      expect(row.status).toBe("disconnected");
      expect(row.refresh_token_enc).toBeNull();
      expect(row.last_error_id).toBeNull();
    });
  });

  it("keeps the row so FK children (threads) survive the disconnect", async () => {
    await withTestDb(async (db) => {
      const u = await seedUser(db);
      const id = await seedConnectedAccount(db, u.id, "rep@example.com");
      await db.execute(
        sql`INSERT INTO email_threads (gmail_thread_id, account_id) VALUES ('t-1', ${id})`,
      );
      await softDisconnectMailbox(db, id, new AbortController().signal);
      const acct = await db.execute(sql`SELECT id FROM email_accounts WHERE id=${id}`);
      const thread = await db.execute(sql`SELECT id FROM email_threads WHERE account_id=${id}`);
      expect(acct.rows).toHaveLength(1);
      expect(thread.rows).toHaveLength(1);
    });
  });

  it("reconnects the same Gmail row through the native service while preserving another mailbox", async () => {
    await withTestDb(async (db) => {
      const owner = await seedMailHttpSession(db, { email: "rep@example.com" });
      const id = await seedConnectedAccount(db, owner.user.id, owner.user.email);
      const previousCredential = encryptToken("synthetic-old-refresh");
      await db.execute(
        sql`UPDATE email_accounts SET refresh_token_enc=${previousCredential} WHERE id=${id}`,
      );
      const other = (
        await db.execute(sql`
          INSERT INTO email_accounts (user_id,email_address,provider,is_default,credentials_enc,connection_settings)
          VALUES (${owner.user.id},'other@imap.test','imap_smtp',true,${encryptToken("synthetic-imap-credential")},'{"identityKey":"other-imap"}'::jsonb)
          RETURNING id
        `)
      ).rows[0] as { id: string };
      const otherBefore = (await db.execute(sql`SELECT * FROM email_accounts WHERE id=${other.id}`))
        .rows;
      await db.execute(
        sql`INSERT INTO email_threads(account_id,gmail_thread_id,subject) VALUES(${id},'retained-thread','Retained Gmail history')`,
      );
      const threadsBefore = (
        await db.execute(sql`SELECT * FROM email_threads WHERE account_id=${id}`)
      ).rows;
      const signal = AbortSignal.timeout(10_000);
      await softDisconnectMailbox(db, id, signal);
      expect(
        (await db.execute(sql`SELECT status,refresh_token_enc FROM email_accounts WHERE id=${id}`))
          .rows,
      ).toEqual([{ status: "disconnected", refresh_token_enc: null }]);

      const rebound = await exchangeAndBind({
        db,
        signal,
        code: "synthetic-reconnect-code",
        sessionUserId: owner.user.id,
        sessionId: owner.context.sessionId,
        sessionEmail: owner.user.email,
        deps: {
          exchangeCode: () =>
            Promise.resolve(
              ok({
                accessToken: "synthetic-access",
                refreshToken: "synthetic-new-refresh",
                scopes: ["gmail.modify", "gmail.send"],
              }),
            ),
          fetchIdentity: () =>
            Promise.resolve(
              ok({ email: owner.user.email, emailVerified: true, hd: "example.com" }),
            ),
        },
      });
      expect(rebound).toEqual(ok({ accountId: id }));
      const current = (
        await db.execute(
          sql`SELECT id,provider,status,is_default,refresh_token_enc,last_error_id,connection_generation,credential_version FROM email_accounts WHERE id=${id}`,
        )
      ).rows[0] as { refresh_token_enc: Buffer };
      expect(current).toMatchObject({
        id,
        provider: "gmail",
        status: "connected",
        is_default: false,
        last_error_id: null,
        connection_generation: 2,
        credential_version: 2,
      });
      expect(current.refresh_token_enc).not.toEqual(previousCredential);
      expect(decryptToken(current.refresh_token_enc)).toEqual(ok("synthetic-new-refresh"));
      expect(
        (await db.execute(sql`SELECT * FROM email_accounts WHERE id=${other.id}`)).rows,
      ).toEqual(otherBefore);
      expect(
        (await db.execute(sql`SELECT * FROM email_threads WHERE account_id=${id}`)).rows,
      ).toEqual(threadsBefore);
      expect(
        (
          await db.execute(
            sql`SELECT id FROM email_accounts WHERE user_id=${owner.user.id} AND provider='gmail'`,
          )
        ).rows,
      ).toEqual([{ id }]);
      expect(
        (
          await db.execute(
            sql`SELECT count(*)::int AS n FROM email_accounts WHERE user_id=${owner.user.id}`,
          )
        ).rows,
      ).toEqual([{ n: 2 }]);
    });
  });
});
