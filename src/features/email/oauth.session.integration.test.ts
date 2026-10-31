import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import { ok } from "@/types/result";
import { seedMailHttpSession } from "./mailConnectionHttp.test-helpers";
import { buildAuthUrl, exchangeAndBind } from "./oauth";

describe("Gmail credential grant native authority", () => {
  it.each(["pending", "stale", "unverified", "revoked"])(
    "refuses %s authority at final credential binding",
    async (state) => {
      await withTestDb(async (db) => {
        const f = await seedMailHttpSession(db, {
          email: "native-owner@example.com",
          assurance: state === "pending" ? "pending" : "password",
          emailVerified: state !== "unverified",
          freshAt: state === "stale" ? new Date(0) : new Date(),
        });
        if (state === "revoked")
          await db.execute(
            sql`UPDATE sessions SET revoked_at=now() WHERE id=${f.context.sessionId}`,
          );
        const result = await exchangeAndBind({
          db,
          signal: new AbortController().signal,
          code: "synthetic-private-code",
          sessionUserId: f.user.id,
          sessionId: f.context.sessionId,
          sessionEmail: f.user.email,
          deps: {
            exchangeCode: () =>
              Promise.resolve(
                ok({ accessToken: "synthetic-at", refreshToken: "synthetic-rt", scopes: [] }),
              ),
            fetchIdentity: () =>
              Promise.resolve(ok({ email: f.user.email, emailVerified: true, hd: "example.com" })),
          },
        });
        expect(result.ok).toBe(false);
        expect(
          (await db.execute(sql`SELECT id FROM email_accounts WHERE user_id=${f.user.id}`)).rows,
        ).toHaveLength(0);
      });
    },
  );

  it("requires PKCE S256 in the Google consent request", () => {
    const url = new URL(
      buildAuthUrl({ userId: "owner", state: "state", codeChallenge: "synthetic-challenge" }),
    );
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe("synthetic-challenge");
  });
});

it("does not bind credentials against an email identity that changed during provider IO", async () => {
  await withTestDb(async (db) => {
    const f = await seedMailHttpSession(db, { email: "original@example.com" });
    const result = await exchangeAndBind({
      db,
      signal: new AbortController().signal,
      code: "private-code",
      sessionUserId: f.user.id,
      sessionId: f.context.sessionId,
      sessionEmail: f.user.email,
      deps: {
        exchangeCode: async () => {
          await db.execute(sql`UPDATE users SET email='changed@example.com' WHERE id=${f.user.id}`);
          return ok({ accessToken: "at", refreshToken: "rt", scopes: [] });
        },
        fetchIdentity: () =>
          Promise.resolve(ok({ email: f.user.email, emailVerified: true, hd: "example.com" })),
      },
    });
    expect(result.ok).toBe(false);
    expect(
      (await db.execute(sql`SELECT id FROM email_accounts WHERE user_id=${f.user.id}`)).rows,
    ).toHaveLength(0);
  });
});
