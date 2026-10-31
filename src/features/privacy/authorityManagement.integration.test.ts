import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { privacyAuthority, privacyCaseMembers } from "@/db/schema";
import { makeTestDb, type TestDb } from "@/test/db";
import { authorityFixture, authoritySignal } from "./authority.test-helpers";
import { replacePrivacyAuthority, replacePrivacyCaseMember } from "./authorityManagement";

let h: TestDb;
beforeAll(async () => {
  h = await makeTestDb();
});
afterAll(async () => {
  await h.close();
});

test("explicit authority manager delegates a current subset and invalidates old authority generations", async () => {
  const manager = await authorityFixture(h, ["authority.manage", "case.review", "case.disclose"]);
  const target = await authorityFixture(h, []);
  expect(
    await replacePrivacyAuthority(
      h.db,
      manager.actor,
      { userId: target.user.id, capabilities: ["case.review"] },
      authoritySignal(),
    ),
  ).toEqual({ ok: true, value: true });
  const [updated] = await h.db
    .select()
    .from(privacyAuthority)
    .where(eq(privacyAuthority.userId, target.user.id));
  expect(updated).toMatchObject({
    capabilities: ["case.review"],
    generation: 2,
    updatedBy: manager.user.id,
  });
  for (const capabilities of [["case.erase.execute"], ["*"], ["case.review", "case.review"]]) {
    expect(
      (
        await replacePrivacyAuthority(
          h.db,
          manager.actor,
          { userId: target.user.id, capabilities },
          authoritySignal(),
        )
      ).ok,
    ).toBe(false);
  }
  expect(
    (
      await replacePrivacyAuthority(
        h.db,
        manager.actor,
        { userId: manager.user.id, capabilities: ["authority.manage", "case.erase.execute"] },
        authoritySignal(),
      )
    ).ok,
  ).toBe(false);
});

test("case assignment requires case authority and the target's workspace capability intersection", async () => {
  const manager = await authorityFixture(h, ["authority.manage", "case.review", "case.disclose"]);
  const target = await authorityFixture(h, ["case.review"]);
  const input = {
    caseId: manager.privacyCase.id,
    userId: target.user.id,
    capabilities: ["case.review"],
  };
  expect(await replacePrivacyCaseMember(h.db, manager.actor, input, authoritySignal())).toEqual({
    ok: true,
    value: true,
  });
  const [member] = await h.db
    .select()
    .from(privacyCaseMembers)
    .where(
      and(
        eq(privacyCaseMembers.caseId, manager.privacyCase.id),
        eq(privacyCaseMembers.userId, target.user.id),
      ),
    );
  expect(member).toMatchObject({ capabilities: ["case.review"], generation: 1 });
  expect(
    (
      await replacePrivacyCaseMember(
        h.db,
        manager.actor,
        { ...input, capabilities: ["case.disclose"] },
        authoritySignal(),
      )
    ).ok,
  ).toBe(false);
  expect(
    (
      await replacePrivacyCaseMember(
        h.db,
        manager.actor,
        { ...input, caseId: randomUUID() },
        authoritySignal(),
      )
    ).ok,
  ).toBe(false);
  const unrelated = await authorityFixture(h, ["authority.manage", "case.review"]);
  expect((await replacePrivacyCaseMember(h.db, unrelated.actor, input, authoritySignal())).ok).toBe(
    false,
  );
});

test("missing manager authority, malformed input and stale sessions cannot change grants", async () => {
  const f = await authorityFixture(h, ["case.review"]);
  const before = await h.db
    .select()
    .from(privacyAuthority)
    .where(eq(privacyAuthority.userId, f.user.id));
  expect(
    await replacePrivacyAuthority(
      h.db,
      f.actor,
      { userId: f.user.id, capabilities: ["authority.manage"] },
      authoritySignal(),
    ),
  ).toEqual({ ok: false, error: "forbidden" });
  expect(
    await replacePrivacyAuthority(
      h.db,
      f.actor,
      { userId: "not-an-id", capabilities: [] },
      authoritySignal(),
    ),
  ).toEqual({ ok: false, error: "invalid_input" });
  expect(
    await h.db.select().from(privacyAuthority).where(eq(privacyAuthority.userId, f.user.id)),
  ).toEqual(before);
});

test("case managers cannot delegate a case capability outside their own reviewed case scope", async () => {
  const manager = await authorityFixture(h, ["authority.manage", "case.disclose"]);
  const target = await authorityFixture(h, ["case.disclose"]);
  await h.db
    .update(privacyCaseMembers)
    .set({ capabilities: ["authority.manage"] })
    .where(
      and(
        eq(privacyCaseMembers.caseId, manager.privacyCase.id),
        eq(privacyCaseMembers.userId, manager.user.id),
      ),
    );
  expect(
    await replacePrivacyCaseMember(
      h.db,
      manager.actor,
      { caseId: manager.privacyCase.id, userId: target.user.id, capabilities: ["case.disclose"] },
      authoritySignal(),
    ),
  ).toEqual({ ok: false, error: "forbidden" });
  const rows = await h.db
    .select()
    .from(privacyCaseMembers)
    .where(
      and(
        eq(privacyCaseMembers.caseId, manager.privacyCase.id),
        eq(privacyCaseMembers.userId, target.user.id),
      ),
    );
  expect(rows).toHaveLength(0);
});
