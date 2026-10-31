import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { env } from "@/config/env";
import { authAccounts, authPasskeys, authUsers, sessions, users } from "@/db/schema";
import { makeTestDb, type TestDb } from "@/test/db";
import { createBetterAuth } from "./auth";
import { nativeAuthGateway } from "./nativeGateway";
import { AuthCookieJar, nativeRequest } from "./passkey.protocol.test-helpers";

let h: TestDb;
beforeAll(async () => {
  h = await makeTestDb();
});
afterAll(async () => {
  await h.close();
});
test("concurrent native factor deletion cannot remove the final strong method", async () => {
  const id = randomUUID();
  const email = `${id}@example.com`;
  await h.db.insert(users).values({ id, email, name: "Concurrent factors", isAdmin: true });
  await h.db
    .insert(authUsers)
    .values({ id, email, name: "Concurrent factors", emailVerified: true });
  const auth = createBetterAuth(h.db);
  await h.db.insert(authAccounts).values({
    userId: id,
    providerId: "credential",
    accountId: id,
    password: await (await auth.$context).password.hash("Long-concurrent-qualification-password"),
  });
  const jar = new AuthCookieJar(new URL(env.BASE_URL).origin);
  expect(
    (
      await nativeRequest(auth, jar, "/sign-in/email", {
        email,
        password: "Long-concurrent-qualification-password",
      })
    ).status,
  ).toBe(200);
  await h.db.update(sessions).set({ assurance: "passkey" }).where(eq(sessions.userId, id));
  const keys = await h.db
    .insert(authPasskeys)
    .values(
      [1, 2].map((number) => ({
        userId: id,
        name: `Key ${number}`,
        publicKey: "fixture",
        credentialID: randomUUID(),
        deviceType: "singleDevice",
        backedUp: false,
      })),
    )
    .returning({ id: authPasskeys.id });
  const responses = await Promise.all(
    keys.map((key) =>
      nativeAuthGateway(
        h.db,
        new Request(`${env.BASE_URL}/api/auth/passkey/delete-passkey`, {
          method: "POST",
          headers: { ...Object.fromEntries(jar.headers()), "content-type": "application/json" },
          body: JSON.stringify({ id: key.id }),
        }),
      ),
    ),
  );
  expect(responses.filter((response) => response.status === 200)).toHaveLength(1);
  expect(await h.db.select().from(authPasskeys).where(eq(authPasskeys.userId, id))).toHaveLength(1);
});
