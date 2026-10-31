import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { users } from "@/db/schema";
import { setUserAdmin } from "@/features/identity/users.service";
import type { PermSetUser } from "@/features/permissions/effective";
import { makeTestDb, type TestDb } from "@/test/db";

let h: TestDb;
const admin: PermSetUser = {
  id: "00000000-0000-4000-8000-0000000000aa",
  type: "admin",
  isActive: true,
  flags: new Set(),
  groupIds: new Set(),
};
beforeAll(async () => {
  h = await makeTestDb();
  await h.db.insert(users).values([
    { id: admin.id, name: "Admin", email: "admin@example.com", isAdmin: true },
    {
      name: "Pending administrator",
      email: "pending@example.com",
      isAdmin: true,
      invitedAt: new Date(),
    },
  ]);
});
afterAll(async () => {
  await h.close();
});
test("an unaccepted administrator invitation cannot authorize demotion of the last established administrator", async () => {
  const result = await setUserAdmin(
    h.db,
    admin,
    { userId: admin.id, isAdmin: false },
    AbortSignal.timeout(10000),
  );
  expect(result.ok).toBe(false);
  const [stored] = await h.db.select().from(users).where(eq(users.id, admin.id));
  expect(stored!.isAdmin).toBe(true);
});
