import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { withTestDb } from "@/db/testing";
import { ok } from "@/types/result";
import { encryptToken } from "./crypto";
import { disconnectMailbox } from "./mailAccountsRepo";
import { seedMailHttpSession } from "./mailConnectionHttp.test-helpers";
import { GMAIL_OAUTH_STATE_COOKIE } from "./oauth";
import { createGmailOAuthCallback } from "./oauthCallback";
import { startGmailOAuth } from "./oauthStart";
import { createGmailOAuthState } from "./oauthState";

const signal = () => AbortSignal.timeout(10_000);
type Fixture = Awaited<ReturnType<typeof seedMailHttpSession>>;
function request(f: Fixture, state: string, cookie = state) {
  const headers = new Headers(f.headers);
  headers.append("cookie", `${GMAIL_OAUTH_STATE_COOKIE}=${cookie}`);
  return new Request(
    `${f.origin}/api/gmail/oauth/callback?state=${state}&code=synthetic-private-code`,
    { headers },
  );
}
function deps(email: string) {
  return {
    exchangeCode: vi
      .fn<Parameters<typeof createGmailOAuthCallback>[1]["exchangeCode"]>()
      .mockResolvedValue(
        ok({ accessToken: "synthetic-access", refreshToken: "synthetic-refresh", scopes: [] }),
      ),
    fetchIdentity: vi.fn(() =>
      Promise.resolve(ok({ email, emailVerified: true, hd: "example.com" })),
    ),
    enqueue: vi.fn(() => Promise.resolve()),
  };
}
function reason(response: Response) {
  return new URL(response.headers.get("location")!).searchParams.get("reason");
}

describe("Gmail OAuth start and callback", () => {
  it("completes a fresh native workflow with PKCE, a private cookie-clearing redirect, and one initial sync", async () => {
    await withTestDb(async (db) => {
      const f = await seedMailHttpSession(db);
      const start = await startGmailOAuth(db, f.headers, signal());
      if (!start.ok) throw new Error("expected native consent");
      const provider = deps(f.user.email);
      const callback = createGmailOAuthCallback(db, provider);
      const response = await callback(request(f, start.value.state));
      expect(new URL(response.headers.get("location")!).searchParams.get("connect")).toBe("ok");
      const verifier = provider.exchangeCode.mock.calls[0]?.[1];
      expect(verifier).toBeDefined();
      expect(createHash("sha256").update(verifier!).digest("base64url")).toBe(
        new URL(start.value.url).searchParams.get("code_challenge"),
      );
      expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
      expect(provider.enqueue).toHaveBeenCalledOnce();
      expect(reason(await callback(request(f, start.value.state)))).toBe("stale_state");
      expect(provider.exchangeCode).toHaveBeenCalledOnce();
    });
  });

  it.each(["pending", "stale", "unverified", "inactive"])(
    "denies %s native sessions before start and callback provider IO",
    async (kind) => {
      await withTestDb(async (db) => {
        const f = await seedMailHttpSession(db, {
          assurance: kind === "pending" ? "pending" : "password",
          freshAt: kind === "stale" ? new Date(0) : new Date(),
          emailVerified: kind !== "unverified",
          isActive: kind !== "inactive",
        });
        expect((await startGmailOAuth(db, f.headers, signal())).ok).toBe(false);
        const provider = deps(f.user.email);
        const response = await createGmailOAuthCallback(db, provider)(request(f, "a".repeat(64)));
        expect(reason(response)).toBe(kind === "stale" ? "fresh_auth_required" : "permission");
        expect(provider.exchangeCode).not.toHaveBeenCalled();
        expect((await db.execute(sql`SELECT id FROM mail_connection_checks`)).rows).toHaveLength(0);
      });
    },
  );

  it("denies cross-origin consent start, cookie substitution and a changed authenticated session", async () => {
    await withTestDb(async (db) => {
      const f = await seedMailHttpSession(db);
      const badHeaders = new Headers(f.headers);
      badHeaders.set("origin", "https://attacker.example");
      expect(await startGmailOAuth(db, badHeaders, signal())).toEqual({
        ok: false,
        error: "permission",
      });
      const state = await createGmailOAuthState(db, f.context, signal());
      if (!state.ok) throw new Error("expected state");
      const other = await seedMailHttpSession(db);
      const provider = deps(f.user.email);
      const callback = createGmailOAuthCallback(db, provider);
      expect(reason(await callback(request(f, state.value.state, "b".repeat(64))))).toBe(
        "stale_state",
      );
      expect(reason(await callback(request(other, state.value.state)))).toBe("stale_state");
      expect(provider.exchangeCode).not.toHaveBeenCalled();
    });
  });

  it("rechecks native authority after the external token exchange and never leaks provider diagnostics", async () => {
    await withTestDb(async (db) => {
      const f = await seedMailHttpSession(db);
      const issued = await createGmailOAuthState(db, f.context, signal());
      if (!issued.ok) throw new Error("expected state");
      const provider = deps(f.user.email);
      provider.exchangeCode.mockImplementation(async () => {
        await db.execute(sql`UPDATE sessions SET revoked_at=now() WHERE id=${f.context.sessionId}`);
        return ok({
          accessToken: "synthetic-access",
          refreshToken: "synthetic-refresh",
          scopes: [],
        });
      });
      const response = await createGmailOAuthCallback(db, provider)(request(f, issued.value.state));
      expect(reason(response)).toBe("fresh_auth_required");
      expect((await db.execute(sql`SELECT id FROM email_accounts`)).rows).toHaveLength(0);
      expect(response.headers.get("location")).not.toMatch(/synthetic|code=|state=|verifier/);
      expect(provider.enqueue).not.toHaveBeenCalled();
    });
  });

  it("blocks reconsent while the exact old Google revocation is pending, including a disconnect during consent", async () => {
    await withTestDb(async (db) => {
      const f = await seedMailHttpSession(db);
      const account = (
        await db.execute(
          sql`INSERT INTO email_accounts(user_id,email_address,provider,refresh_token_enc) VALUES(${f.user.id},${f.user.email},'gmail',${encryptToken("old-refresh")}) RETURNING id`,
        )
      ).rows[0] as { id: string };
      const state = await createGmailOAuthState(db, f.context, signal());
      if (!state.ok) throw new Error("expected state");
      await disconnectMailbox(db, f.user.id, account.id, signal());
      expect(await startGmailOAuth(db, f.headers, signal())).toEqual({
        ok: false,
        error: "revocation_pending",
      });
      const provider = deps(f.user.email);
      const response = await createGmailOAuthCallback(db, provider)(request(f, state.value.state));
      expect(reason(response)).toBe("revocation_pending");
      expect(provider.exchangeCode).not.toHaveBeenCalled();
      expect(
        (
          await db.execute(
            sql`SELECT status,refresh_token_enc FROM email_accounts WHERE id=${account.id}`,
          )
        ).rows[0],
      ).toEqual({ status: "disconnected", refresh_token_enc: null });
      await db.execute(
        sql`UPDATE auth_integration_revocations SET status='revoked',token_enc=NULL`,
      );
      expect((await startGmailOAuth(db, f.headers, signal())).ok).toBe(true);
    });
  });
});

it("does not store a returned Google grant if disconnect occurs during the token exchange", async () => {
  await withTestDb(async (db) => {
    const f = await seedMailHttpSession(db);
    const account = (
      await db.execute(
        sql`INSERT INTO email_accounts(user_id,email_address,provider,refresh_token_enc) VALUES(${f.user.id},${f.user.email},'gmail',${encryptToken("previous-refresh")}) RETURNING id`,
      )
    ).rows[0] as { id: string };
    const state = await createGmailOAuthState(db, f.context, signal());
    if (!state.ok) throw new Error("expected state");
    const provider = deps(f.user.email);
    provider.exchangeCode.mockImplementation(async () => {
      await disconnectMailbox(db, f.user.id, account.id, signal());
      return ok({ accessToken: "new-access", refreshToken: "new-refresh", scopes: [] });
    });
    const response = await createGmailOAuthCallback(db, provider)(request(f, state.value.state));
    expect(reason(response)).toBe("revocation_pending");
    expect(
      (
        await db.execute(
          sql`SELECT status,refresh_token_enc FROM email_accounts WHERE id=${account.id}`,
        )
      ).rows[0],
    ).toEqual({ status: "disconnected", refresh_token_enc: null });
    expect(provider.enqueue).not.toHaveBeenCalled();
  });
});

it("consumes the state even after a provider transport failure and redacts all secret details", async () => {
  await withTestDb(async (db) => {
    const f = await seedMailHttpSession(db);
    const state = await createGmailOAuthState(db, f.context, signal());
    if (!state.ok) throw new Error("expected state");
    const provider = deps(f.user.email);
    provider.exchangeCode.mockRejectedValue(new Error("private-code-verifier-provider-response"));
    const callback = createGmailOAuthCallback(db, provider);
    const response = await callback(request(f, state.value.state));
    expect(reason(response)).toBe("error");
    expect(response.headers.get("location")).not.toMatch(/private|code=|state=|verifier/);
    expect(reason(await callback(request(f, state.value.state)))).toBe("stale_state");
    expect(provider.exchangeCode).toHaveBeenCalledOnce();
  });
});
