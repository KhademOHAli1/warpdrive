import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { persons, privacyCaseMembers, privacyCases } from "@/db/schema";
import { makeTestDb, type TestDb } from "@/test/db";
import { authorityFixture, authoritySignal } from "./authority.test-helpers";
import { listPrivacyDiscoveryPage } from "./discovery";
import { discoveryFixture } from "./discovery.test-helpers";

let h: TestDb;
beforeAll(async () => {
  h = await makeTestDb();
});
afterAll(async () => {
  await h.close();
});

test("C01/C02/C03: disclosure and review capabilities, current proof and cursor context are independently required", async () => {
  const f = await discoveryFixture(h);
  const first = await listPrivacyDiscoveryPage(
    h.db,
    f.authority.actor,
    { caseId: f.privacyCase.id, limit: 1 },
    authoritySignal(),
  );
  assert(first.ok && first.value.nextCursor !== null);
  const cursor = first.value.nextCursor;
  expect(cursor).not.toContain(f.subject.id);
  expect(cursor).not.toContain(f.privacyCase.id);
  expect(cursor).not.toContain(f.authority.user.id);
  expect(
    (
      await listPrivacyDiscoveryPage(
        h.db,
        f.authority.actor,
        { caseId: f.privacyCase.id, limit: 1, cursor: `${cursor}bad` },
        authoritySignal(),
      )
    ).ok,
  ).toBe(false);
  await h.db
    .update(privacyCaseMembers)
    .set({ generation: 2 })
    .where(
      and(
        eq(privacyCaseMembers.caseId, f.privacyCase.id),
        eq(privacyCaseMembers.userId, f.authority.user.id),
      ),
    );
  expect(
    await listPrivacyDiscoveryPage(
      h.db,
      f.authority.actor,
      { caseId: f.privacyCase.id, limit: 1, cursor },
      authoritySignal(),
    ),
  ).toEqual({ ok: false, error: "forbidden" });
  const discloseOnly = await authorityFixture(h, ["case.disclose"]);
  expect(
    await listPrivacyDiscoveryPage(
      h.db,
      discloseOnly.actor,
      { caseId: discloseOnly.privacyCase.id, limit: 10 },
      authoritySignal(),
    ),
  ).toEqual({ ok: false, error: "forbidden" });
  const reviewOnly = await authorityFixture(h, ["case.review"]);
  expect(
    await listPrivacyDiscoveryPage(
      h.db,
      reviewOnly.actor,
      { caseId: reviewOnly.privacyCase.id, limit: 10 },
      authoritySignal(),
    ),
  ).toEqual({ ok: false, error: "forbidden" });
  await h.db
    .update(privacyCases)
    .set({ verifiedAt: null })
    .where(eq(privacyCases.id, f.privacyCase.id));
  expect(
    await listPrivacyDiscoveryPage(
      h.db,
      f.authority.actor,
      { caseId: f.privacyCase.id, limit: 10 },
      authoritySignal(),
    ),
  ).toEqual({ ok: false, error: "forbidden" });
});

test("P07B/C12: workforce identity does not auto-link same-address contacts or owned CRM records", async () => {
  const f = await authorityFixture(h, ["case.review", "case.disclose"]);
  const [contact] = await h.db
    .insert(persons)
    .values({
      name: "Same-address CRM contact",
      primaryEmail: f.user.email,
      ownerId: f.user.id,
      visibilityLevel: "all",
    })
    .returning();
  assert(contact !== undefined);
  const result = await listPrivacyDiscoveryPage(
    h.db,
    f.actor,
    { caseId: f.privacyCase.id, limit: 100 },
    authoritySignal(),
  );
  assert(result.ok, JSON.stringify(result));
  expect(result.value.candidates).toContainEqual(
    expect.objectContaining({ store: "users", recordId: f.user.id, confidence: "exact" }),
  );
  expect(result.value.candidates).toContainEqual(
    expect.objectContaining({ store: "auth_users", recordId: f.user.id, confidence: "exact" }),
  );
  expect(
    result.value.candidates.some(
      (candidate) => candidate.store === "persons" && candidate.recordId === contact.id,
    ),
  ).toBe(false);
  expect(result.value.blockers).toContainEqual(
    expect.objectContaining({ store: "email_accounts", status: "unsupported" }),
  );
  expect(result.value.coverage.length).toBeGreaterThanOrEqual(93);
});

test("P07B/C11: an actual newly introduced table cannot silently inherit discovery coverage", async () => {
  const f = await authorityFixture(h, ["case.review", "case.disclose"]);
  await h.pool.query("CREATE TABLE privacy_discovery_unknown_fixture(id uuid PRIMARY KEY)");
  try {
    const result = await listPrivacyDiscoveryPage(
      h.db,
      f.actor,
      { caseId: f.privacyCase.id, limit: 100 },
      authoritySignal(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("unclassified_store");
  } finally {
    await h.pool.query("DROP TABLE privacy_discovery_unknown_fixture");
  }
});

test("P07B/C11: a new nonpublic namespace cannot bypass the runtime discovery guard", async () => {
  const f = await authorityFixture(h, ["case.review", "case.disclose"]);
  await h.pool.query("CREATE SCHEMA privacy_discovery_unknown_fixture");
  await h.pool.query(
    "CREATE TABLE privacy_discovery_unknown_fixture.personal_records(id uuid PRIMARY KEY)",
  );
  try {
    const result = await listPrivacyDiscoveryPage(
      h.db,
      f.actor,
      { caseId: f.privacyCase.id, limit: 100 },
      authoritySignal(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("unclassified_store");
  } finally {
    await h.pool.query("DROP SCHEMA privacy_discovery_unknown_fixture CASCADE");
  }
});
