import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, it } from "vitest";
import { authIntegrationRevocations } from "@/db/schema/authManagement";
import {
  calendarOAuthAttempts,
  calendarProviderAccounts,
} from "@/db/schema/calendarProviderAccounts";
import { seedUser } from "@/db/testing/factories";
import { revokeManagedUserAccess } from "@/features/auth/management/administration";
import { setUserActive } from "@/features/identity/users.service";
import type { PermSetUser } from "@/features/permissions/effective";
import { makeTestDb } from "@/test/db";
import {
  beginTestCalendar,
  connectTestCalendar,
  calendarTestSignal as signal,
} from "./accountTestHelpers";

let ctx: Awaited<ReturnType<typeof makeTestDb>>;
beforeEach(async () => {
  ctx = await makeTestDb();
});
afterEach(async () => {
  await ctx.close();
});
it.each(["deactivate", "revokeAccess"] as const)(
  "%s purges Calendar credentials and callbacks without queuing shared-app external revocation",
  async (command) => {
    const adminUser = await seedUser(ctx.db, { isAdmin: true });
    const admin: PermSetUser = {
      id: adminUser.id,
      type: "admin",
      isActive: true,
      flags: new Set(),
      groupIds: new Set(),
    };
    const owner = await seedUser(ctx.db);
    await connectTestCalendar(ctx.db, owner.id);
    await beginTestCalendar(ctx.db, owner.id);
    const result =
      command === "deactivate"
        ? await setUserActive(ctx.db, admin, { userId: owner.id, isActive: false }, signal())
        : await revokeManagedUserAccess(ctx.db, admin, owner.id, signal());
    expect(result.ok).toBe(true);
    expect((await ctx.db.select().from(calendarProviderAccounts))[0]).toMatchObject({
      status: "disconnected",
      refreshTokenEnc: null,
    });
    expect(
      (await ctx.db.select().from(calendarOAuthAttempts)).every(
        (attempt) => attempt.cancelledAt !== null && attempt.codeVerifierEnc === null,
      ),
    ).toBe(true);
    expect(await ctx.db.select().from(authIntegrationRevocations)).toHaveLength(0);
    await setUserActive(ctx.db, admin, { userId: owner.id, isActive: true }, signal());
    expect(
      (
        await ctx.db
          .select()
          .from(calendarProviderAccounts)
          .where(eq(calendarProviderAccounts.userId, owner.id))
      )[0]?.status,
    ).toBe("disconnected");
  },
);
