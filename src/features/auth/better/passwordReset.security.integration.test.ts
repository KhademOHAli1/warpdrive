import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { env } from "@/config/env";
import {
  authAccounts,
  authMailOutbox,
  authSecurityEvents,
  authVerifications,
  sessions,
} from "@/db/schema";
import { makeTestDb, type TestDb } from "@/test/db";
import { nativeAuthGateway } from "./nativeGateway";
import { anonymousResetFixture, grantState } from "./nativeGateway.anonymous.test-helpers";

let h: TestDb;
beforeAll(async () => {
  h = await makeTestDb();
});
afterAll(async () => {
  await h.close();
});

function requestReset(email: string, redirectTo = "/auth/reset-password", origin = env.BASE_URL) {
  return nativeAuthGateway(
    h.db,
    new Request(`${env.BASE_URL}/api/auth/request-password-reset`, {
      method: "POST",
      headers: {
        origin: new URL(origin).origin,
        "content-type": "application/json",
        cookie: "warpdrive_locale=fa",
      },
      body: JSON.stringify({ email, redirectTo }),
    }),
  );
}

describe("public password reset security", () => {
  test("known and unknown addresses receive the same public acknowledgement", async () => {
    const f = await anonymousResetFixture(h);
    const known = await requestReset(`${f.userId}@example.com`);
    const unknown = await requestReset("not-enrolled@unknown.invalid");
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(known.status);
    expect(await unknown.json()).toEqual(await known.json());
    expect(
      await h.db
        .select()
        .from(authMailOutbox)
        .where(eq(authMailOutbox.recipient, "not-enrolled@unknown.invalid")),
    ).toHaveLength(0);
  });

  test("an expired proof leaves the password and connected-app grants unchanged", async () => {
    const f = await anonymousResetFixture(h);
    await h.db
      .update(authVerifications)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(authVerifications.value, f.userId));
    expect((await nativeAuthGateway(h.db, f.request)).status).toBe(400);
    const [account] = await h.db
      .select()
      .from(authAccounts)
      .where(eq(authAccounts.id, f.accountId));
    expect(account?.password === f.password).toBe(true);
    expect(await grantState(h, f.userId)).toEqual({
      access: [false],
      refresh: [false],
      codes: [false],
    });
  });

  test("concurrent redemption has one winner, one audit notice, and no automatic login", async () => {
    const f = await anonymousResetFixture(h);
    const responses = await Promise.all([
      nativeAuthGateway(h.db, f.request.clone()),
      nativeAuthGateway(h.db, f.request.clone()),
    ]);
    expect(responses.filter((response) => response.status === 200)).toHaveLength(1);
    expect(responses.filter((response) => response.status === 400)).toHaveLength(1);
    expect((await nativeAuthGateway(h.db, f.request)).status).toBe(400);
    expect(await h.db.select().from(sessions).where(eq(sessions.userId, f.userId))).toHaveLength(0);
    expect(
      await h.db
        .select()
        .from(authSecurityEvents)
        .where(
          and(
            eq(authSecurityEvents.targetUserId, f.userId),
            eq(authSecurityEvents.action, "security.password.reset"),
          ),
        ),
    ).toHaveLength(1);
    expect(await grantState(h, f.userId)).toEqual({
      access: [true],
      refresh: [true],
      codes: [true],
    });
  });

  test("cross-origin requests and external return URLs cannot queue reset messages", async () => {
    const f = await anonymousResetFixture(h);
    const before = await h.db
      .select()
      .from(authMailOutbox)
      .where(eq(authMailOutbox.userId, f.userId));
    expect(
      (
        await requestReset(
          `${f.userId}@example.com`,
          "/auth/reset-password",
          "https://attacker.invalid",
        )
      ).status,
    ).toBe(403);
    expect(
      (await requestReset(`${f.userId}@example.com`, "https://attacker.invalid/reset")).status,
    ).toBe(403);
    expect(
      await h.db.select().from(authMailOutbox).where(eq(authMailOutbox.userId, f.userId)),
    ).toHaveLength(before.length);
  });
});
