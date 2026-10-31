import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import { ok } from "@/types/result";
import { encryptToken } from "./crypto";
import { seedMailHttpSession } from "./mailConnectionHttp.test-helpers";
import { exchangeAndBind } from "./oauth";

type TestDb = Parameters<Parameters<typeof withTestDb>[0]>[0];
async function user(db: TestDb, email: string) {
  const f = await seedMailHttpSession(db, { email });
  return { id: f.user.id, sessionId: f.context.sessionId };
}

function bind(db: TestDb, owner: { id: string; sessionId: string }, email: string) {
  return exchangeAndBind({
    db,
    code: "test-code",
    sessionUserId: owner.id,
    sessionId: owner.sessionId,
    sessionEmail: email,
    signal: new AbortController().signal,
    deps: {
      exchangeCode: () =>
        Promise.resolve(
          ok({
            accessToken: "at",
            refreshToken: "new-refresh",
            scopes: ["gmail.modify", "gmail.send"],
          }),
        ),
      fetchIdentity: () => Promise.resolve(ok({ email, emailVerified: true, hd: "example.com" })),
    },
  });
}

describe("Gmail identity preservation with multiple mailboxes", () => {
  it("makes the first account default, reconnects the same UUID and advances its generation", async () => {
    await withTestDb(async (db) => {
      const owner = await user(db, "first@example.com");
      const initial = await bind(db, owner, "first@example.com");
      expect(initial.ok).toBe(true);
      if (!initial.ok) return;
      await db.execute(
        sql`INSERT INTO email_threads(account_id,gmail_thread_id,subject) VALUES(${initial.value.accountId},'history-thread','Preserve history')`,
      );
      const reconnected = await bind(db, owner, "first@example.com");
      expect(reconnected).toEqual(initial);
      const row = (
        await db.execute(
          sql`SELECT is_default,provider,connection_generation FROM email_accounts WHERE id=${initial.value.accountId}`,
        )
      ).rows[0] as { is_default: boolean; provider: string; connection_generation: number };
      expect(row).toEqual({ is_default: true, provider: "gmail", connection_generation: 2 });
      expect(
        (
          await db.execute(
            sql`SELECT subject FROM email_threads WHERE account_id=${initial.value.accountId}`,
          )
        ).rows,
      ).toHaveLength(1);
    });
  });

  it("adds Gmail without replacing a different default IMAP mailbox", async () => {
    await withTestDb(async (db) => {
      const owner = await user(db, "gmail-owner@example.com");
      const imap = (
        await db.execute(
          sql`INSERT INTO email_accounts(user_id,email_address,provider,is_default,credentials_enc) VALUES(${owner.id},'imap-owner@example.net','imap_smtp',true,${encryptToken("imap-secret")}) RETURNING id`,
        )
      ).rows[0] as { id: string };
      const result = await bind(db, owner, "gmail-owner@example.com");
      expect(result.ok).toBe(true);
      const rows = (
        await db.execute(
          sql`SELECT id,provider,is_default FROM email_accounts WHERE user_id=${owner.id} ORDER BY is_default DESC`,
        )
      ).rows as { id: string; provider: string; is_default: boolean }[];
      expect(rows).toHaveLength(2);
      expect(rows[0]).toEqual({ id: imap.id, provider: "imap_smtp", is_default: true });
      expect(rows[1]?.provider).toBe("gmail");
      expect(rows[1]?.is_default).toBe(false);
    });
  });

  it("cannot replace a same-owner IMAP account merely because its email matches", async () => {
    await withTestDb(async (db) => {
      const owner = await user(db, "collision@example.com");
      const imap = (
        await db.execute(
          sql`INSERT INTO email_accounts(user_id,email_address,provider,credentials_enc) VALUES(${owner.id},'collision@example.com','imap_smtp',${encryptToken("keep-imap")}) RETURNING id`,
        )
      ).rows[0] as { id: string };
      const result = await bind(db, owner, "collision@example.com");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.id).toBe("E_GMAIL_006");
      const row = (
        await db.execute(
          sql`SELECT id,provider,refresh_token_enc FROM email_accounts WHERE email_address='collision@example.com'`,
        )
      ).rows[0];
      expect(row).toEqual({ id: imap.id, provider: "imap_smtp", refresh_token_enc: null });
    });
  });

  it("refuses an inactive user even if Google identity proof succeeds", async () => {
    await withTestDb(async (db) => {
      const owner = await user(db, "inactive@example.com");
      await db.execute(sql`UPDATE users SET is_active=false WHERE id=${owner.id}`);
      expect((await bind(db, owner, "inactive@example.com")).ok).toBe(false);
      expect(
        (await db.execute(sql`SELECT id FROM email_accounts WHERE user_id=${owner.id}`)).rows,
      ).toHaveLength(0);
    });
  });
});

it("returns a recoverable failure when token endpoint IO throws", async () => {
  await withTestDb(async (db) => {
    const owner = await user(db, "network-failure@example.com");
    const result = await exchangeAndBind({
      db,
      code: "test-code",
      sessionUserId: owner.id,
      sessionId: owner.sessionId,
      sessionEmail: "network-failure@example.com",
      signal: new AbortController().signal,
      deps: {
        exchangeCode: () => Promise.reject(new Error("sensitive-token-endpoint-detail")),
        fetchIdentity: () => {
          throw new Error("No identity request without a token");
        },
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.id).toBe("E_GMAIL_001");
    expect(JSON.stringify(result)).not.toContain("sensitive-token-endpoint-detail");
    expect(
      (await db.execute(sql`SELECT id FROM email_accounts WHERE user_id=${owner.id}`)).rows,
    ).toHaveLength(0);
  });
});

it("makes a new Gmail mailbox default after all historical mailboxes were disconnected", async () => {
  await withTestDb(async (db) => {
    const owner = await user(db, "new-default@example.com");
    await db.execute(
      sql`INSERT INTO email_accounts(user_id,email_address,provider,status,is_default) VALUES(${owner.id},'historical@example.com','gmail','disconnected',true)`,
    );
    const result = await bind(db, owner, "new-default@example.com");
    expect(result.ok).toBe(true);
    const defaults = (
      await db.execute(
        sql`SELECT email_address FROM email_accounts WHERE user_id=${owner.id} AND is_default=true`,
      )
    ).rows;
    expect(defaults).toEqual([{ email_address: "new-default@example.com" }]);
  });
});
