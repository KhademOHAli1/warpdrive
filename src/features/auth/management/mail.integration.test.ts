import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { authMailOutbox } from "@/db/schema/authManagement";
import { makeTestDb, type TestDb } from "@/test/db";
import { expireAuthenticationRecords } from "./administration";
import { dispatchAuthMail, enqueueAuthMail } from "./mail";

let h: TestDb;
beforeAll(async () => {
  h = await makeTestDb();
});
afterAll(async () => {
  await h.close();
});
test("parallel dispatchers claim a durable authentication message only once", async () => {
  const signal = () => AbortSignal.timeout(10000);
  const message = await enqueueAuthMail(
    h.db,
    {
      recipient: "user@example.com",
      locale: "de",
      kind: "verification",
      url: "https://app.example.com/auth/verify?token=test-only-link",
    },
    signal(),
  );
  await Promise.all([dispatchAuthMail(h.db, signal()), dispatchAuthMail(h.db, signal())]);
  const [row] = await h.db.select().from(authMailOutbox).where(eq(authMailOutbox.id, message.id));
  expect(row!.status).toBe("captured");
  expect(row!.attempts).toBe(1);
});
test("an authentication message cannot be queued to an untrusted origin", async () => {
  await expect(
    enqueueAuthMail(
      h.db,
      {
        recipient: "user@example.com",
        locale: "fa",
        kind: "password_reset",
        url: "https://attacker.example/auth/reset?token=private",
      },
      AbortSignal.timeout(10000),
    ),
  ).rejects.toMatchObject({ id: "E_AUTH_010" });
});

test("an old invitation delivery is cancelled instead of sending an already expired bearer link", async () => {
  const message = await enqueueAuthMail(
    h.db,
    {
      recipient: "user@example.com",
      locale: "fa",
      kind: "invitation",
      url: "https://app.example.com/auth/invite?token=expired-test-link",
    },
    AbortSignal.timeout(10000),
  );
  await h.db
    .update(authMailOutbox)
    .set({ createdAt: new Date(Date.now() - 80 * 60 * 60 * 1000) })
    .where(eq(authMailOutbox.id, message.id));
  await dispatchAuthMail(h.db, AbortSignal.timeout(10000));
  const [row] = await h.db.select().from(authMailOutbox).where(eq(authMailOutbox.id, message.id));
  expect(row!.status).toBe("cancelled");
  expect(row!.attempts).toBe(0);
});

test("a crashed delivery cannot revive an expired reset link when its lease is reclaimed", async () => {
  const message = await enqueueAuthMail(
    h.db,
    {
      recipient: "user@example.com",
      locale: "de",
      kind: "password_reset",
      url: "https://app.example.com/auth/reset?token=test-expired-reset",
    },
    AbortSignal.timeout(10000),
  );
  await h.db
    .update(authMailOutbox)
    .set({
      status: "sending",
      attempts: 1,
      createdAt: new Date(Date.now() - 3_600_000),
      claimedAt: new Date(Date.now() - 300_000),
    })
    .where(eq(authMailOutbox.id, message.id));
  await dispatchAuthMail(h.db, AbortSignal.timeout(10000));
  const [row] = await h.db.select().from(authMailOutbox).where(eq(authMailOutbox.id, message.id));
  expect(row!.status).toBe("cancelled");
  expect(row!.payloadEnc).toHaveLength(0);
});

test("a crashed final attempt becomes a visible failure that an administrator can retry", async () => {
  const message = await enqueueAuthMail(
    h.db,
    { recipient: "user@example.com", locale: "en", kind: "security_change" },
    AbortSignal.timeout(10000),
  );
  await h.db
    .update(authMailOutbox)
    .set({ status: "sending", attempts: 5, claimedAt: new Date(Date.now() - 300_000) })
    .where(eq(authMailOutbox.id, message.id));
  await dispatchAuthMail(h.db, AbortSignal.timeout(10000));
  const [row] = await h.db.select().from(authMailOutbox).where(eq(authMailOutbox.id, message.id));
  expect(row!.status).toBe("failed");
});

test("maintenance expires old delivery metadata after the retention window", async () => {
  const message = await enqueueAuthMail(
    h.db,
    { recipient: "user@example.com", locale: "fa", kind: "security_change" },
    AbortSignal.timeout(10000),
  );
  await h.db
    .update(authMailOutbox)
    .set({ status: "captured", createdAt: new Date(Date.now() - 181 * 86_400_000) })
    .where(eq(authMailOutbox.id, message.id));
  await expireAuthenticationRecords(h.db, AbortSignal.timeout(10000));
  expect(
    await h.db.select().from(authMailOutbox).where(eq(authMailOutbox.id, message.id)),
  ).toHaveLength(0);
});
