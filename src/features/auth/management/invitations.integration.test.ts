import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { ADMIN_DEFAULT_FLAGS, REGULAR_DEFAULT_FLAGS } from "@/constants/permissionFlags";
import { permissionSets, users, visibilityGroups } from "@/db/schema";
import { authInvitations, authMailOutbox } from "@/db/schema/authManagement";
import { decryptToken } from "@/features/email/crypto";
import type { PermSetUser } from "@/features/permissions/effective";
import { makeTestDb, type TestDb } from "@/test/db";
import {
  consumeInvitation,
  issueInvitation,
  resendInvitation,
  revokeInvitation,
  validateInvitation,
} from "./invitations";

let h: TestDb;
const signal = () => AbortSignal.timeout(10000);
const admin: PermSetUser = {
  id: "00000000-0000-0000-0000-0000000000aa",
  type: "admin",
  isActive: true,
  flags: new Set(),
  groupIds: new Set(),
};
const regular: PermSetUser = {
  id: "00000000-0000-0000-0000-0000000000bb",
  type: "regular",
  isActive: true,
  flags: new Set(),
  groupIds: new Set(),
};

beforeAll(async () => {
  h = await makeTestDb();
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  await h.db.execute(
    sql`TRUNCATE users, permission_sets, visibility_groups RESTART IDENTITY CASCADE`,
  );
  await h.db.insert(permissionSets).values([
    { name: "Admin", flags: ADMIN_DEFAULT_FLAGS },
    { name: "Regular", flags: REGULAR_DEFAULT_FLAGS, isDefault: true },
  ]);
  await h.db.insert(visibilityGroups).values({ name: "Everyone" });
  await h.db.insert(users).values([
    { id: admin.id, name: "Admin", email: "admin@example.com", isAdmin: true },
    { id: regular.id, name: "Regular", email: "regular@example.com" },
  ]);
});

async function tokenForInvitation(invitationId: string): Promise<string> {
  const [mail] = await h.db
    .select()
    .from(authMailOutbox)
    .where(eq(authMailOutbox.invitationId, invitationId));
  expect(mail).toBeDefined();
  const decrypted = decryptToken(mail!.payloadEnc);
  expect(decrypted.ok).toBe(true);
  if (!decrypted.ok) return "";
  const payload = JSON.parse(decrypted.value) as { url: string };
  return new URL(payload.url).searchParams.get("token") ?? "";
}

describe("invitation-only admission", () => {
  test("stores only a digest, uses the intended recipient and consumes exactly once", async () => {
    const result = await issueInvitation(
      h.db,
      admin,
      { email: "invite@example.com", name: "Invited", isAdmin: false, locale: "fa" },
      signal(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const token = await tokenForInvitation(result.value.invitationId);
    expect(token.length).toBeGreaterThanOrEqual(40);
    const [row] = await h.db
      .select()
      .from(authInvitations)
      .where(eq(authInvitations.id, result.value.invitationId));
    expect(row!.tokenHash).not.toBe(token);
    expect(await validateInvitation(h.db, token, signal())).toMatchObject({
      ok: true,
      value: { userId: result.value.userId, email: "invite@example.com" },
    });
    expect((await consumeInvitation(h.db, token, "different@example.com", signal())).ok).toBe(
      false,
    );
    const claims = await Promise.all([
      consumeInvitation(h.db, token, "invite@example.com", signal()),
      consumeInvitation(h.db, token, "invite@example.com", signal()),
    ]);
    expect(claims.filter((claim) => claim.ok)).toHaveLength(1);
    expect((await validateInvitation(h.db, token, signal())).ok).toBe(false);
  });

  test("resending replaces the token and revoking cancels the replacement", async () => {
    const issued = await issueInvitation(
      h.db,
      admin,
      { email: "resend@example.com", name: "Invited", isAdmin: false, locale: "de" },
      signal(),
    );
    if (!issued.ok) return;
    const firstToken = await tokenForInvitation(issued.value.invitationId);
    const resent = await resendInvitation(h.db, admin, issued.value.invitationId, signal());
    expect(resent.ok).toBe(true);
    if (!resent.ok) return;
    const secondToken = await tokenForInvitation(resent.value.invitationId);
    expect(secondToken).not.toBe(firstToken);
    expect((await validateInvitation(h.db, firstToken, signal())).ok).toBe(false);
    expect((await validateInvitation(h.db, secondToken, signal())).ok).toBe(true);
    expect((await revokeInvitation(h.db, admin, resent.value.invitationId, signal())).ok).toBe(
      true,
    );
    expect((await validateInvitation(h.db, secondToken, signal())).ok).toBe(false);
  });

  test("direct callers cannot invite without manage authority or consume a disabled recipient", async () => {
    expect(
      (
        await issueInvitation(
          h.db,
          regular,
          { email: "blocked@example.com", name: "Blocked", isAdmin: true, locale: "en" },
          signal(),
        )
      ).ok,
    ).toBe(false);
    const issued = await issueInvitation(
      h.db,
      admin,
      { email: "disabled@example.com", name: "Disabled", isAdmin: false, locale: "en" },
      signal(),
    );
    if (!issued.ok) return;
    const token = await tokenForInvitation(issued.value.invitationId);
    await h.db.update(users).set({ isActive: false }).where(eq(users.id, issued.value.userId));
    expect((await consumeInvitation(h.db, token, "disabled@example.com", signal())).ok).toBe(false);
  });
});
