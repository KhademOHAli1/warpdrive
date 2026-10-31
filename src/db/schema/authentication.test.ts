import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { users } from "@/db/schema/identity";
import { makeTestDb, type TestDb } from "@/test/db";
import { authAccounts, authUsers } from "./authentication";

let h: TestDb;
beforeAll(async () => {
  h = await makeTestDb();
});
afterAll(async () => {
  await h.close();
});

test("auth identity retains the existing CRM UUID and requires a real local user", async () => {
  const [user] = await h.db
    .insert(users)
    .values({ email: "auth@example.com", name: "User" })
    .returning();
  const [identity] = await h.db
    .insert(authUsers)
    .values({ id: user!.id, email: user!.email, name: user!.name, emailVerified: true })
    .returning();
  expect(identity?.id).toBe(user!.id);
  await expect(
    h.db
      .insert(authUsers)
      .values({ id: randomUUID(), email: "missing@example.com", name: "Missing" }),
  ).rejects.toThrow();
});

test("one provider subject cannot be attached to two CRM accounts", async () => {
  const [user] = await h.db.select().from(authUsers);
  await h.db
    .insert(authAccounts)
    .values({ userId: user!.id, providerId: "google", accountId: "subject-1" });
  await expect(
    h.db
      .insert(authAccounts)
      .values({ userId: user!.id, providerId: "google", accountId: "subject-1" }),
  ).rejects.toThrow();
});
