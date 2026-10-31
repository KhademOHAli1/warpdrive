import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { env } from "@/config/env";
import {
  authInvitations,
  authMailOutbox,
  authSecurityEvents,
  authUsers,
  settings,
  userPreferences,
  users,
} from "@/db/schema";
import { decryptToken } from "@/features/email/crypto";
import { makeTestDb, type TestDb } from "@/test/db";
import { bootstrapFirstAdministrator } from "./bootstrapOperator";
import { renewFirstAdministratorInvitation } from "./bootstrapRenewal";
import { validateInvitation } from "./invitations";

let h: TestDb;
const email = env.SEED_ADMIN_EMAIL || "first-owner@example.com";
const signal = () => AbortSignal.timeout(10_000);
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

async function setup(locale: "fa" | "de" = "fa") {
  const result = await bootstrapFirstAdministrator(
    h.db,
    { email, name: "Original owner", locale, operatorConfirmed: true },
    signal(),
  );
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("Bootstrap fixture failed");
  const [invitation] = await h.db.select().from(authInvitations);
  const [user] = await h.db.select().from(users);
  return {
    input: { email, operatorConfirmed: true },
    user: user!,
    invitation: invitation!,
    ...result.value,
  };
}

async function tokenFor(invitationId: string) {
  const [mail] = await h.db
    .select()
    .from(authMailOutbox)
    .where(eq(authMailOutbox.invitationId, invitationId));
  const payload = decryptToken(mail!.payloadEnc);
  expect(payload.ok).toBe(true);
  if (!payload.ok) return "";
  return (
    new URL((JSON.parse(payload.value) as { url: string }).url).searchParams.get("token") ?? ""
  );
}

describe("host renewal of the unclaimed first administrator invitation", () => {
  test("renews an expired link with hashed/encrypted localized delivery without changing identity or bootstrap", async () => {
    const f = await setup();
    const oldToken = await tokenFor(f.invitationId);
    await h.db
      .update(authInvitations)
      .set({ expiresAt: new Date(Date.now() - 1) })
      .where(eq(authInvitations.id, f.invitationId));
    expect((await validateInvitation(h.db, oldToken, signal())).ok).toBe(false);
    const beforeSettings = await h.db.select().from(settings);
    const beforePreferences = await h.db.select().from(userPreferences);
    const renewed = await renewFirstAdministratorInvitation(h.db, f.input, signal());
    expect(renewed.ok).toBe(true);
    if (!renewed.ok) return;
    expect(renewed.value.userId).toBe(f.userId);
    expect(await h.db.select().from(users)).toEqual([f.user]);
    expect(await h.db.select().from(settings)).toEqual(beforeSettings);
    expect(await h.db.select().from(userPreferences)).toEqual(beforePreferences);
    expect((await validateInvitation(h.db, oldToken, signal())).ok).toBe(false);
    const token = await tokenFor(renewed.value.invitationId);
    expect(token === oldToken).toBe(false);
    expect(await validateInvitation(h.db, token, signal())).toMatchObject({
      ok: true,
      value: { userId: f.userId, email },
    });
    const [invitation] = await h.db
      .select()
      .from(authInvitations)
      .where(eq(authInvitations.id, renewed.value.invitationId));
    expect(invitation?.tokenHash === token).toBe(false);
    const [mail] = await h.db
      .select()
      .from(authMailOutbox)
      .where(eq(authMailOutbox.invitationId, renewed.value.invitationId));
    expect(mail).toMatchObject({ locale: "fa", recipient: email, status: "pending" });
    expect(mail?.payloadEnc.toString().includes(token)).toBe(false);
    expect(await h.db.select().from(authUsers)).toHaveLength(0);
  });

  test("refuses missing confirmation, changed recipients, accepted/native identities and established workspace replacement", async () => {
    const f = await setup();
    expect(
      (
        await renewFirstAdministratorInvitation(
          h.db,
          { ...f.input, operatorConfirmed: false },
          signal(),
        )
      ).ok,
    ).toBe(false);
    expect(
      (
        await renewFirstAdministratorInvitation(
          h.db,
          { email: "different@example.com", operatorConfirmed: true },
          signal(),
        )
      ).ok,
    ).toBe(false);
    await h.db
      .update(authInvitations)
      .set({ acceptedAt: new Date() })
      .where(eq(authInvitations.id, f.invitationId));
    expect((await renewFirstAdministratorInvitation(h.db, f.input, signal())).ok).toBe(false);
    await h.db
      .update(authInvitations)
      .set({ acceptedAt: null })
      .where(eq(authInvitations.id, f.invitationId));
    await h.db
      .insert(authUsers)
      .values({ id: f.userId, email, name: "Claimed identity", emailVerified: true });
    expect((await renewFirstAdministratorInvitation(h.db, f.input, signal())).ok).toBe(false);
    await h.db.delete(authUsers);
    for (const change of [
      { googleSub: "stable-existing-subject" },
      { isActive: false },
      { invitedAt: null },
      { isAdmin: false },
    ]) {
      await h.db.update(users).set(change).where(eq(users.id, f.userId));
      expect((await renewFirstAdministratorInvitation(h.db, f.input, signal())).ok).toBe(false);
      await h.db
        .update(users)
        .set({ googleSub: null, isActive: true, invitedAt: f.user.invitedAt, isAdmin: true })
        .where(eq(users.id, f.userId));
    }
    await h.db
      .insert(users)
      .values({ email: "other-admin@example.com", name: "Other administrator", isAdmin: true });
    expect((await renewFirstAdministratorInvitation(h.db, f.input, signal())).ok).toBe(false);
    expect(await h.db.select().from(authInvitations)).toHaveLength(1);
    expect(await h.db.select().from(authMailOutbox)).toHaveLength(1);
  });

  test("overlapping renewals of one invitation produce one German replacement", async () => {
    const f = await setup("de");
    let release = () => {};
    let locked = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const held = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const blocker = h.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(815274001::bigint)`);
      locked();
      await gate;
    });
    await held;
    const attempts = [
      renewFirstAdministratorInvitation(h.db, f.input, signal()),
      renewFirstAdministratorInvitation(h.db, f.input, signal()),
    ];
    try {
      let count = 0;
      const deadline = Date.now() + 5000;
      while (count < 2 && Date.now() < deadline) {
        const rows = await h.pool.query<{ count: string }>(
          "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event='advisory'",
        );
        count = Number(rows.rows[0]?.count ?? 0);
        if (count < 2)
          await new Promise((resolve) => {
            setTimeout(resolve, 10);
          });
      }
      expect(count).toBe(2);
    } finally {
      release();
      await blocker;
    }
    expect((await Promise.all(attempts)).filter((result) => result.ok)).toHaveLength(1);
    expect(await h.db.select().from(users)).toHaveLength(1);
    expect(await h.db.select().from(authInvitations)).toHaveLength(2);
    expect(await h.db.select().from(authMailOutbox)).toMatchObject([
      { status: "cancelled", locale: "de" },
      { status: "pending", locale: "de" },
    ]);
    expect(
      (await h.db.select().from(authSecurityEvents)).filter(
        (event) => event.action === "bootstrap.invitation_renewed",
      ),
    ).toHaveLength(1);
  });

  test("outbox failure rolls invitation invalidation and message cancellation back", async () => {
    const f = await setup();
    const token = await tokenFor(f.invitationId);
    await h.db.execute(
      sql`ALTER TABLE auth_mail_outbox ADD CONSTRAINT renewal_test_queue_failure CHECK (kind <> 'invitation' OR status = 'cancelled') NOT VALID`,
    );
    try {
      await expect(renewFirstAdministratorInvitation(h.db, f.input, signal())).rejects.toThrow();
      expect(await h.db.select().from(authInvitations)).toEqual([f.invitation]);
      expect(await h.db.select().from(authMailOutbox)).toMatchObject([{ status: "pending" }]);
      expect((await validateInvitation(h.db, token, signal())).ok).toBe(true);
      expect(
        (await h.db.select().from(authSecurityEvents)).filter(
          (event) => event.action === "bootstrap.invitation_renewed",
        ),
      ).toHaveLength(0);
    } finally {
      await h.db.execute(
        sql`ALTER TABLE auth_mail_outbox DROP CONSTRAINT renewal_test_queue_failure`,
      );
    }
  });
});
