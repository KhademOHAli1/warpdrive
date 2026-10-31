import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { env } from "@/config/env";
import {
  authAccounts,
  authUsers,
  permissionSets,
  settings,
  userPreferences,
  users,
  visibilityGroupMembers,
  visibilityGroups,
} from "@/db/schema";
import { authInvitations, authMailOutbox } from "@/db/schema/authManagement";
import { decryptToken } from "@/features/email/crypto";
import { makeTestDb, type TestDb } from "@/test/db";
import { bootstrapFirstAdministrator } from "./bootstrapOperator";
import { hashInvitationToken, validateInvitation } from "./invitations";

let h: TestDb;
const signal = () => AbortSignal.timeout(10_000);
const input = {
  email: env.SEED_ADMIN_EMAIL || "first-admin@example.com",
  name: "First administrator",
  locale: "fa" as const,
  operatorConfirmed: true,
};
beforeAll(async () => {
  h = await makeTestDb();
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  await h.db.execute(
    sql`TRUNCATE users, settings, permission_sets, visibility_groups, pipelines, labels CASCADE`,
  );
});

describe("host-only first administrator invitation", () => {
  test("seeds permissions/group, queues encrypted Farsi invitation and grants no native identity", async () => {
    const result = await bootstrapFirstAdministrator(h.db, input, signal());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [user] = await h.db.select().from(users).where(eq(users.id, result.value.userId));
    expect(user).toMatchObject({
      email: input.email.toLowerCase(),
      isAdmin: true,
      googleSub: null,
    });
    expect(user?.invitedAt).not.toBeNull();
    const [permission] = await h.db
      .select()
      .from(permissionSets)
      .where(eq(permissionSets.id, user?.permissionSetId ?? ""));
    expect(permission?.name).toBe("Admin");
    const [group] = await h.db
      .select()
      .from(visibilityGroups)
      .where(eq(visibilityGroups.id, user?.primaryVisibilityGroupId ?? ""));
    expect(group?.name).toBe("Everyone");
    expect(
      await h.db
        .select()
        .from(visibilityGroupMembers)
        .where(eq(visibilityGroupMembers.userId, user!.id)),
    ).toHaveLength(1);
    const [preference] = await h.db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, user!.id));
    expect(preference?.ui).toMatchObject({
      localePreferences: { locale: "fa", calendar: "persian" },
    });
    expect((await h.db.select().from(settings))[0]?.bootstrappedAt).not.toBeNull();
    expect(await h.db.select().from(authUsers)).toHaveLength(0);
    expect(await h.db.select().from(authAccounts)).toHaveLength(0);
    const [mail] = await h.db.select().from(authMailOutbox);
    expect(mail).toMatchObject({
      recipient: input.email.toLowerCase(),
      locale: "fa",
      status: "pending",
      kind: "invitation",
    });
    const plaintext = decryptToken(mail!.payloadEnc);
    expect(plaintext.ok).toBe(true);
    if (!plaintext.ok) return;
    const payload = JSON.parse(plaintext.value) as { url: string; text: string };
    expect(payload.text).toMatch(/[\u0600-\u06ff]/);
    const token = new URL(payload.url).searchParams.get("token") ?? "";
    const [invitation] = await h.db.select().from(authInvitations);
    expect(invitation?.tokenHash).toBe(hashInvitationToken(token));
    expect(mail?.payloadEnc.toString()).not.toContain(token);
    expect(await validateInvitation(h.db, token, signal())).toMatchObject({
      ok: true,
      value: { userId: user?.id, email: input.email.toLowerCase() },
    });
  });

  test("requires confirmation, valid input and the configured seed email without mutating", async () => {
    expect(
      await bootstrapFirstAdministrator(h.db, { ...input, operatorConfirmed: false }, signal()),
    ).toMatchObject({ ok: false, error: "confirmation_required" });
    expect(
      await bootstrapFirstAdministrator(h.db, { ...input, email: "invalid" }, signal()),
    ).toMatchObject({ ok: false, error: "invalid_input" });
    if (env.SEED_ADMIN_EMAIL !== "")
      expect(
        await bootstrapFirstAdministrator(
          h.db,
          { ...input, email: "different@example.com" },
          signal(),
        ),
      ).toMatchObject({ ok: false, error: "seed_admin_mismatch" });
    expect(await h.db.select().from(users)).toHaveLength(0);
    expect(await h.db.select().from(authMailOutbox)).toHaveLength(0);
  });

  test("refuses established workspaces and existing identity takeover, preserving UUID and authority", async () => {
    await h.db.insert(settings).values({ baseCurrency: "EUR", bootstrappedAt: new Date() });
    expect(await bootstrapFirstAdministrator(h.db, input, signal())).toMatchObject({
      ok: false,
      error: "already_initialized",
    });
    await h.db.delete(settings);
    const [existing] = await h.db
      .insert(users)
      .values({ email: input.email, name: "Existing member", googleSub: "existing-stable-subject" })
      .returning();
    expect(await bootstrapFirstAdministrator(h.db, input, signal())).toMatchObject({
      ok: false,
      error: "already_initialized",
    });
    expect(await h.db.select().from(users)).toEqual([existing]);
    expect(await h.db.select().from(authInvitations)).toHaveLength(0);
  });

  test("concurrent host invocations elect and invite exactly once", async () => {
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        bootstrapFirstAdministrator(h.db, { ...input, locale: "de" }, signal()),
      ),
    );
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(await h.db.select().from(users)).toHaveLength(1);
    expect(await h.db.select().from(authInvitations)).toHaveLength(1);
    expect(await h.db.select().from(authMailOutbox)).toMatchObject([{ locale: "de" }]);
  });
});
