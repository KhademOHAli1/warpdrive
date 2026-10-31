import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { authPasskeys, authTwoFactors } from "@/db/schema";
import { makeTestDb, type TestDb } from "@/test/db";
import { lockAuthAccount } from "./accountLock";
import { nativeAuthGateway } from "./nativeGateway";
import {
  authenticationFixture,
  deferred,
  waitsForAdvisoryLock,
} from "./nativeGateway.race.test-helpers";
import { resolveWorkflowSession } from "./sessionPolicy";

let h: TestDb;
beforeAll(async () => {
  h = await makeTestDb();
});
afterAll(async () => {
  await h.close();
});

describe("unauthenticated proof serializes with host-operator factor removal", () => {
  for (const method of ["passkey", "totp"] as const) {
    test(`${method} valid proof works through the account-locked gateway`, async () => {
      const fixture = await authenticationFixture(h, method);
      const response = await nativeAuthGateway(h.db, fixture.request);
      expect(response.status).toBe(200);
      fixture.jar.apply(response);
      expect(
        (await resolveWorkflowSession(h.db, fixture.jar.headers(), AbortSignal.timeout(5000)))?.user
          .id,
      ).toBe(fixture.userId);
    });
    test(`${method} verification waits for the account lock and rejects a removed factor`, async () => {
      const fixture = await authenticationFixture(h, method);
      const held = deferred();
      const release = deferred();
      const removal = h.db.transaction(async (tx) => {
        await lockAuthAccount(tx, fixture.userId, AbortSignal.timeout(10_000));
        held.resolve();
        await release.promise;
        if (method === "passkey")
          await tx.delete(authPasskeys).where(eq(authPasskeys.userId, fixture.userId));
        else await tx.delete(authTwoFactors).where(eq(authTwoFactors.userId, fixture.userId));
      });
      await held.promise;
      const verification = nativeAuthGateway(h.db, fixture.request);
      const polling = new AbortController();
      try {
        expect(
          await Promise.race([
            verification.then(() => false),
            waitsForAdvisoryLock(h, polling.signal),
          ]),
        ).toBe(true);
      } finally {
        polling.abort();
        release.resolve();
        await removal;
      }
      const response = await verification;
      expect(response.status).not.toBe(200);
      fixture.jar.apply(response);
      expect(
        await resolveWorkflowSession(h.db, fixture.jar.headers(), AbortSignal.timeout(5000)),
      ).toBeNull();
    });
  }
});
