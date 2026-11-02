import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { AppError } from "@/constants/errorIds";
import { withTestDb } from "@/db/testing";
import { revokeUserAccess } from "@/features/auth/management/offboarding";
import { err, ok, type Result } from "@/types/result";
import { decryptToken, encryptToken } from "./crypto";
import { ensureAccessToken } from "./tokens";

type TestDb = Parameters<Parameters<typeof withTestDb>[0]>[0];
type RefreshResult = Result<
  { accessToken: string; expiresIn: number; refreshToken?: string },
  AppError
>;

function deferred<T>() {
  let finish!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    finish = resolve;
  });
  return { promise, resolve: (value: T) => finish(value) };
}

async function fixture(db: TestDb) {
  const user = (
    await db.execute(
      sql`INSERT INTO users(email,name) VALUES('token-race@example.com','Token race') RETURNING id`,
    )
  ).rows[0] as { id: string };
  const account = (
    await db.execute(
      sql`INSERT INTO email_accounts(user_id,email_address,refresh_token_enc) VALUES(${user.id},'token-race@example.com',${encryptToken("original-refresh")}) RETURNING id`,
    )
  ).rows[0] as { id: string };
  return { userId: user.id, accountId: account.id };
}

async function accountState(db: TestDb, id: string) {
  return (
    await db.execute(
      sql`SELECT status,refresh_token_enc,connection_generation,last_error_id FROM email_accounts WHERE id=${id}`,
    )
  ).rows[0] as {
    status: string;
    refresh_token_enc: Buffer | null;
    connection_generation: number;
    last_error_id: string | null;
  };
}

const signal = () => new AbortController().signal;

describe("live Gmail token authority", () => {
  it.each(["disconnected", "paused", "suspended", "non-gmail"])(
    "never uses a cached token for %s authority",
    async (state) => {
      await withTestDb(async (db) => {
        const f = await fixture(db);
        if (state === "disconnected")
          await db.execute(
            sql`UPDATE email_accounts SET status='disconnected' WHERE id=${f.accountId}`,
          );
        if (state === "paused")
          await db.execute(sql`UPDATE email_accounts SET paused=true WHERE id=${f.accountId}`);
        if (state === "suspended")
          await db.execute(sql`UPDATE users SET is_active=false WHERE id=${f.userId}`);
        if (state === "non-gmail")
          await db.execute(
            sql`UPDATE email_accounts SET provider='imap_smtp' WHERE id=${f.accountId}`,
          );
        const result = await ensureAccessToken(db, {
          accountId: f.accountId,
          signal: signal(),
          cached: {
            token: "old-access",
            expiresAt: Date.now() + 600_000,
            connectionGeneration: 1,
            credentialVersion: 1,
          },
          deps: {
            refresh: () => {
              throw new Error("Blocked authority must not refresh");
            },
          },
        });
        expect(result.ok).toBe(false);
      });
    },
  );

  it("does not resurrect a credential or return an access token when offboarding wins during refresh", async () => {
    await withTestDb(async (db) => {
      const f = await fixture(db);
      const started = deferred<void>();
      const response = deferred<RefreshResult>();
      const pending = ensureAccessToken(db, {
        accountId: f.accountId,
        signal: signal(),
        deps: {
          refresh: () => {
            started.resolve();
            return response.promise;
          },
        },
      });
      await started.promise;
      await revokeUserAccess(db, f.userId, signal());
      response.resolve(
        ok({ accessToken: "in-flight-access", expiresIn: 3600, refreshToken: "rotated-refresh" }),
      );
      expect((await pending).ok).toBe(false);
      const row = await accountState(db, f.accountId);
      expect(row.status).toBe("disconnected");
      expect(row.refresh_token_enc).toBeNull();
      expect(row.connection_generation).toBeGreaterThan(1);
    });
  });

  it("does not disconnect a reconnected account on an old in-flight invalid_grant", async () => {
    await withTestDb(async (db) => {
      const f = await fixture(db);
      const started = deferred<void>();
      const response = deferred<RefreshResult>();
      const pending = ensureAccessToken(db, {
        accountId: f.accountId,
        signal: signal(),
        deps: {
          refresh: () => {
            started.resolve();
            return response.promise;
          },
        },
      });
      await started.promise;
      await db.execute(
        sql`UPDATE email_accounts SET refresh_token_enc=${encryptToken("new-connection")},connection_generation=connection_generation+1 WHERE id=${f.accountId}`,
      );
      response.resolve(err(new AppError("E_GMAIL_002", "old grant rejected", {})));
      expect((await pending).ok).toBe(false);
      const row = await accountState(db, f.accountId);
      expect(row.status).toBe("connected");
      expect(row.last_error_id).toBeNull();
      expect(decryptToken(row.refresh_token_enc!)).toEqual(ok("new-connection"));
    });
  });

  it("rejects a stale cached generation and tags the refreshed result", async () => {
    await withTestDb(async (db) => {
      const f = await fixture(db);
      await db.execute(
        sql`UPDATE email_accounts SET connection_generation=2 WHERE id=${f.accountId}`,
      );
      const result = await ensureAccessToken(db, {
        accountId: f.accountId,
        signal: signal(),
        cached: {
          token: "obsolete",
          expiresAt: Date.now() + 600_000,
          connectionGeneration: 1,
          credentialVersion: 1,
        },
        deps: { refresh: () => Promise.resolve(ok({ accessToken: "current", expiresIn: 3600 })) },
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.token).toBe("current");
        expect(result.value.connectionGeneration).toBe(2);
      }
    });
  });

  it("cancellation during refresh cannot persist a rotated credential", async () => {
    await withTestDb(async (db) => {
      const f = await fixture(db);
      const controller = new AbortController();
      const result = ensureAccessToken(db, {
        accountId: f.accountId,
        signal: controller.signal,
        deps: {
          refresh: () => {
            controller.abort();
            return Promise.resolve(
              ok({ accessToken: "aborted", expiresIn: 3600, refreshToken: "must-not-store" }),
            );
          },
        },
      });
      await expect(result).rejects.toMatchObject({ name: "AbortError" });
      const row = await accountState(db, f.accountId);
      expect(decryptToken(row.refresh_token_enc!)).toEqual(ok("original-refresh"));
      expect(row.connection_generation).toBe(1);
    });
  });
});

it("classifies provider IO failure as transient without leaking details or destroying credentials", async () => {
  await withTestDb(async (db) => {
    const f = await fixture(db);
    const result = await ensureAccessToken(db, {
      accountId: f.accountId,
      signal: signal(),
      deps: {
        refresh: () => Promise.reject(new Error("sensitive-provider-details")),
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.id).toBe("E_GMAIL_001");
    expect(JSON.stringify(result)).not.toContain("sensitive-provider-details");
    const row = await accountState(db, f.accountId);
    expect(row.status).toBe("connected");
    expect(decryptToken(row.refresh_token_enc!)).toEqual(ok("original-refresh"));
  });
});

it("rotates credential version without invalidating queued-send connection authority", async () => {
  await withTestDb(async (db) => {
    const f = await fixture(db);
    const result = await ensureAccessToken(db, {
      accountId: f.accountId,
      signal: signal(),
      deps: {
        refresh: () =>
          Promise.resolve(ok({ accessToken: "current", expiresIn: 3600, refreshToken: "rotated" })),
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.connectionGeneration).toBe(1);
      expect(result.value.credentialVersion).toBe(2);
    }
    const row = (
      await db.execute(
        sql`SELECT connection_generation,credential_version FROM email_accounts WHERE id=${f.accountId}`,
      )
    ).rows[0];
    expect(row).toEqual({ connection_generation: 1, credential_version: 2 });
  });
});

it("rejects a stale cached credential version even when connection authority is unchanged", async () => {
  await withTestDb(async (db) => {
    const f = await fixture(db);
    await db.execute(sql`UPDATE email_accounts SET credential_version=2 WHERE id=${f.accountId}`);
    const result = await ensureAccessToken(db, {
      accountId: f.accountId,
      signal: signal(),
      cached: {
        token: "obsolete-credential",
        expiresAt: Date.now() + 600_000,
        connectionGeneration: 1,
        credentialVersion: 1,
      },
      deps: { refresh: () => Promise.resolve(ok({ accessToken: "current", expiresIn: 3600 })) },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.token).toBe("current");
  });
});
