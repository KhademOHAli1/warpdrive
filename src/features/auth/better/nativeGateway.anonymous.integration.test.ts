import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { env } from "@/config/env";
import { authAccounts, authMailOutbox, authRateLimits, authSecurityEvents } from "@/db/schema";
import { lockMcpGrants } from "@/features/auth/management/mcpGrants";
import { makeTestDb, type TestDb } from "@/test/db";
import { nativeAuthGateway } from "./nativeGateway";
import {
  anonymousResetFixture,
  grantState,
  waitForNativeLock,
} from "./nativeGateway.anonymous.test-helpers";
import { deferred } from "./nativeGateway.race.test-helpers";

let h: TestDb;
beforeAll(async () => {
  h = await makeTestDb();
});
afterAll(async () => {
  await h.close();
});
const signal = () => AbortSignal.timeout(10_000);

describe("anonymous native mutations retain transaction-scoped grant locks", () => {
  test("ordinary authentication denial retains its abuse-control writes", async () => {
    const f = await anonymousResetFixture(h);
    const before = (await h.db.select().from(authRateLimits)).reduce(
      (sum, row) => sum + row.count,
      0,
    );
    const response = await nativeAuthGateway(
      h.db,
      new Request(`${env.BASE_URL}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { origin: new URL(env.BASE_URL).origin, "content-type": "application/json" },
        body: JSON.stringify({
          email: `${f.userId}@example.com`,
          password: "Incorrect-qualification-password",
        }),
      }),
    );
    expect(response.status).toBe(401);
    const after = (await h.db.select().from(authRateLimits)).reduce(
      (sum, row) => sum + row.count,
      0,
    );
    expect(after).toBeGreaterThan(before);
    expect(await grantState(h, f.userId)).toEqual({
      access: [false],
      refresh: [false],
      codes: [false],
    });
  });
  test("reset keeps the grant lock through credential mutation, revocation and notification commit", async () => {
    const f = await anonymousResetFixture(h);
    const held = deferred();
    const release = deferred();
    const polling = new AbortController();
    const blocker = h.db.transaction(async (tx) => {
      await tx.select().from(authAccounts).where(eq(authAccounts.id, f.accountId)).for("update");
      held.resolve();
      await release.promise;
    });
    await held.promise;
    const reset = nativeAuthGateway(h.db, f.request);
    let observer: Promise<Awaited<ReturnType<typeof grantState>>> | undefined;
    try {
      expect(
        await Promise.race([
          reset.then(() => false),
          waitForNativeLock(h, '%update "auth_accounts"%', polling.signal),
        ]),
      ).toBe(true);
      observer = h.db.transaction(async (tx) => {
        await lockMcpGrants(tx, signal());
        return grantState(h, f.userId);
      });
      expect(
        await Promise.race([
          observer.then(() => false),
          waitForNativeLock(h, "%pg_advisory_xact_lock%", polling.signal),
        ]),
      ).toBe(true);
    } finally {
      release.resolve();
      polling.abort();
      await blocker;
      await reset;
      await observer;
    }
    expect((await reset).status).toBe(200);
    expect(await observer).toEqual({ access: [true], refresh: [true], codes: [true] });
    const [account] = await h.db
      .select()
      .from(authAccounts)
      .where(eq(authAccounts.id, f.accountId));
    expect(
      await (await f.auth.$context).password.verify({
        hash: account!.password!,
        password: "New-secure-qualification-password",
      }),
    ).toBe(true);
    expect(
      await h.db
        .select()
        .from(authMailOutbox)
        .where(
          and(eq(authMailOutbox.userId, f.userId), eq(authMailOutbox.kind, "security_change")),
        ),
    ).toHaveLength(1);
  });
  test("a native reset notification failure rolls credential/token/grants back for safe retry", async () => {
    const f = await anonymousResetFixture(h);
    await h.db.execute(
      sql`ALTER TABLE auth_mail_outbox ADD CONSTRAINT gateway_test_notification_failure CHECK (kind <> 'security_change') NOT VALID`,
    );
    try {
      expect((await nativeAuthGateway(h.db, f.request.clone())).status).toBeGreaterThanOrEqual(500);
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
      ).toHaveLength(0);
    } finally {
      await h.db.execute(
        sql`ALTER TABLE auth_mail_outbox DROP CONSTRAINT gateway_test_notification_failure`,
      );
    }
    expect((await nativeAuthGateway(h.db, f.request)).status).toBe(200);
    expect(await grantState(h, f.userId)).toEqual({
      access: [true],
      refresh: [true],
      codes: [true],
    });
  });
});
