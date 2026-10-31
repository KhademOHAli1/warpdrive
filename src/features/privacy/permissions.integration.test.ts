import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  authUsers,
  permissionSets,
  privacyAuthority,
  privacyCaseMembers,
  privacyCases,
  sessions,
  teamMembers,
  teams,
  users,
} from "@/db/schema";
import { makeTestDb, type TestDb } from "@/test/db";
import { ok } from "@/types/result";
import { authorityFixture, authoritySignal } from "./authority.test-helpers";
import { withPrivacyAuthority } from "./permissions";

let h: TestDb;
beforeAll(async () => {
  h = await makeTestDb();
});
afterAll(async () => {
  await h.close();
});

describe("privacy case authority (P02A/P02B, C01-C03)", () => {
  test("only explicit workspace and matching case capabilities authorize a fresh verified actor", async () => {
    const f = await authorityFixture(h);
    const allowed = await withPrivacyAuthority(
      h.db,
      f.actor,
      { capability: "case.disclose", caseId: f.privacyCase.id },
      authoritySignal(),
      (_tx, ticket) => Promise.resolve(ok(ticket)),
    );
    expect(allowed.ok).toBe(true);
    if (!allowed.ok) return;
    expect(allowed.value).toMatchObject({
      userId: f.user.id,
      sessionId: f.session.id,
      caseId: f.privacyCase.id,
      authorityGeneration: 1,
      membershipGeneration: 1,
    });
    for (const options of [
      { capability: "case.erase.execute" as const, caseId: f.privacyCase.id },
      { capability: "case.disclose" as const, caseId: randomUUID() },
      { capability: "case.disclose" as const },
    ])
      expect(
        await withPrivacyAuthority(h.db, f.actor, options, authoritySignal(), () =>
          Promise.resolve(ok(true)),
        ),
      ).toEqual({ ok: false, error: "forbidden" });
  });

  test("administrator status and a manager's CRM permissions cannot replace explicit case authority", async () => {
    const f = await authorityFixture(h);
    await h.db.update(users).set({ isAdmin: true }).where(eq(users.id, f.user.id));
    await h.db.delete(privacyAuthority).where(eq(privacyAuthority.userId, f.user.id));
    expect(
      await withPrivacyAuthority(
        h.db,
        f.actor,
        { capability: "case.disclose", caseId: f.privacyCase.id },
        authoritySignal(),
        () => Promise.resolve(ok(true)),
      ),
    ).toEqual({ ok: false, error: "forbidden" });
    const unrelated = await authorityFixture(h);
    const [permissionSet] = await h.db
      .insert(permissionSets)
      .values({ name: `Privacy manager ${unrelated.user.id}`, flags: { "team.viewMembers": true } })
      .returning();
    const [team] = await h.db
      .insert(teams)
      .values({ name: "Synthetic managed team", managerId: unrelated.user.id })
      .returning();
    expect(permissionSet).toBeDefined();
    expect(team).toBeDefined();
    if (permissionSet === undefined || team === undefined) return;
    await h.db
      .update(users)
      .set({ permissionSetId: permissionSet.id })
      .where(eq(users.id, unrelated.user.id));
    await h.db.insert(teamMembers).values({ teamId: team.id, userId: f.user.id });
    expect(
      await withPrivacyAuthority(
        h.db,
        unrelated.actor,
        { capability: "case.disclose", caseId: f.privacyCase.id },
        authoritySignal(),
        () => Promise.resolve(ok(true)),
      ),
    ).toEqual({ ok: false, error: "forbidden" });
  });

  const changes = [
    [
      "inactive",
      async (f: Awaited<ReturnType<typeof authorityFixture>>) =>
        h.db.update(users).set({ isActive: false }).where(eq(users.id, f.user.id)),
    ],
    [
      "invited",
      async (f: Awaited<ReturnType<typeof authorityFixture>>) =>
        h.db.update(users).set({ invitedAt: new Date() }).where(eq(users.id, f.user.id)),
    ],
    [
      "unverified",
      async (f: Awaited<ReturnType<typeof authorityFixture>>) =>
        h.db.update(authUsers).set({ emailVerified: false }).where(eq(authUsers.id, f.user.id)),
    ],
    [
      "pending MFA",
      async (f: Awaited<ReturnType<typeof authorityFixture>>) =>
        h.db.update(sessions).set({ assurance: "pending" }).where(eq(sessions.id, f.session.id)),
    ],
    [
      "stale fresh proof",
      async (f: Awaited<ReturnType<typeof authorityFixture>>) =>
        h.db
          .update(sessions)
          .set({ freshAuthenticatedAt: new Date(Date.now() - 3_600_000) })
          .where(eq(sessions.id, f.session.id)),
    ],
    [
      "revoked",
      async (f: Awaited<ReturnType<typeof authorityFixture>>) =>
        h.db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, f.session.id)),
    ],
    [
      "expired",
      async (f: Awaited<ReturnType<typeof authorityFixture>>) =>
        h.db
          .update(sessions)
          .set({ expiresAt: new Date(Date.now() - 1) })
          .where(eq(sessions.id, f.session.id)),
    ],
    [
      "legacy",
      async (f: Awaited<ReturnType<typeof authorityFixture>>) =>
        h.db.update(sessions).set({ authMethod: "legacy" }).where(eq(sessions.id, f.session.id)),
    ],
    [
      "unverified subject",
      async (f: Awaited<ReturnType<typeof authorityFixture>>) =>
        h.db
          .update(privacyCases)
          .set({ verifiedAt: null })
          .where(eq(privacyCases.id, f.privacyCase.id)),
    ],
  ] as const;
  for (const [label, change] of changes)
    test(`denies ${label} before invoking the effect`, async () => {
      const f = await authorityFixture(h);
      await change(f);
      let invoked = false;
      expect(
        await withPrivacyAuthority(
          h.db,
          f.actor,
          { capability: "case.disclose", caseId: f.privacyCase.id },
          authoritySignal(),
          () => {
            invoked = true;
            return Promise.resolve(ok(true));
          },
        ),
      ).toEqual({ ok: false, error: "forbidden" });
      expect(invoked).toBe(false);
    });

  test("rechecks actor, membership and case generations at each later effect", async () => {
    const f = await authorityFixture(h);
    const request = { capability: "case.disclose" as const, caseId: f.privacyCase.id };
    const issued = await withPrivacyAuthority(
      h.db,
      f.actor,
      request,
      authoritySignal(),
      (_tx, ticket) => Promise.resolve(ok(ticket)),
    );
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;
    expect(
      (
        await withPrivacyAuthority(
          h.db,
          f.actor,
          { ...request, expected: issued.value },
          authoritySignal(),
          () => Promise.resolve(ok(true)),
        )
      ).ok,
    ).toBe(true);
    await h.db
      .update(privacyCaseMembers)
      .set({ generation: 2 })
      .where(
        and(
          eq(privacyCaseMembers.caseId, f.privacyCase.id),
          eq(privacyCaseMembers.userId, f.user.id),
        ),
      );
    expect(
      await withPrivacyAuthority(
        h.db,
        f.actor,
        { ...request, expected: issued.value },
        authoritySignal(),
        () => Promise.resolve(ok(true)),
      ),
    ).toEqual({ ok: false, error: "forbidden" });
    expect(
      await withPrivacyAuthority(
        h.db,
        { ...f.actor, userId: randomUUID() },
        request,
        authoritySignal(),
        () => Promise.resolve(ok(true)),
      ),
    ).toEqual({ ok: false, error: "forbidden" });
  });
});
