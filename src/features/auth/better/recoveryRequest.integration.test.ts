import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { authRecoveryRequests, users } from "@/db/schema";
import { makeTestDb, type TestDb } from "@/test/db";
import { requestFactorRecovery } from "./recoveryRequest";

let h: TestDb;
beforeAll(async () => {
  h = await makeTestDb();
});
afterAll(async () => {
  await h.close();
});
test("unaccepted invitations cannot manufacture lost-factor requests", async () => {
  const [user] = await h.db
    .insert(users)
    .values({ email: "not-enrolled@example.com", name: "Pending", invitedAt: new Date() })
    .returning();
  await requestFactorRecovery(h.db, user!.email, AbortSignal.timeout(5000));
  expect(
    await h.db.select().from(authRecoveryRequests).where(eq(authRecoveryRequests.userId, user!.id)),
  ).toHaveLength(0);
});
