import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import { authUsers, users } from "@/db/schema";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
import { authDatabaseHooks } from "@/features/auth/better/databaseHooks";
import { updateUserProfile } from "./profile.service";

describe("updateUserProfile", () => {
  it("keeps the authentication display name aligned without reverting profile edits on a factor update", async () => {
    await withTestDb(async (db) => {
      const user = await seedUser(db, { name: "Old Name" });
      const [identity] = await db
        .insert(authUsers)
        .values({ id: user.id, email: user.email, name: user.name, emailVerified: true })
        .returning();
      await updateUserProfile(
        db,
        { actorId: user.id, name: "Real Name" },
        AbortSignal.timeout(2000),
      );
      const [updated] = await db.select().from(authUsers).where(eq(authUsers.id, user.id));
      expect(updated?.name).toBe("Real Name");
      const after = authDatabaseHooks(db).user?.update?.after;
      await after?.(identity!, null);
      const [profile] = await db.select().from(users).where(eq(users.id, user.id));
      expect(profile?.name).toBe("Real Name");
    });
  });
  it("persists the new display name", async () => {
    await withTestDb(async (db) => {
      const u = await seedUser(db, { name: "Old Name" });

      const r = await updateUserProfile(
        db,
        { actorId: u.id, name: "Real Name" },
        AbortSignal.timeout(2000),
      );

      expect(r.ok).toBe(true);
      const [after] = await db.select().from(users).where(eq(users.id, u.id));
      expect(after?.name).toBe("Real Name");
    });
  });

  it("rejects a blank name with USER_PROFILE_INVALID and leaves the row untouched", async () => {
    await withTestDb(async (db) => {
      const u = await seedUser(db, { name: "Old Name" });

      const r = await updateUserProfile(
        db,
        { actorId: u.id, name: "   " },
        AbortSignal.timeout(2000),
      );

      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.id).toBe(ERROR_IDS.USER_PROFILE_INVALID);
      const [after] = await db.select().from(users).where(eq(users.id, u.id));
      expect(after?.name).toBe("Old Name");
    });
  });
});
