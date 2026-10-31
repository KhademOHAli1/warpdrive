import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";
import * as schema from "@/db/schema";
import { privacyCaseEvents, privacyCaseMembers, privacyCases } from "@/db/schema";
import { makeTestDb, type TestDb } from "@/test/db";
import { ok } from "@/types/result";
import { authorityFixture, authoritySignal } from "./authority.test-helpers";
import { transitionPrivacyCase } from "./caseCommands";
import { decryptPrivacy } from "./crypto";
import { createPrivacyCase } from "./intake";
import { withPrivacyAuthority } from "./permissions";

let h: TestDb;
beforeAll(async () => {
  h = await makeTestDb();
});
afterAll(async () => {
  await h.close();
});
const request = () => ({
  intakeKey: randomUUID(),
  kind: "access",
  locale: "fa",
  subject: { kind: "external", description: "PRIVATE-SUBJECT-SENTINEL" },
  recipient: { channel: "email", address: "synthetic-subject@example.test" },
  summary: "PRIVATE-INTAKE-SENTINEL",
});

test("P03A/P03B: intake is durable and idempotent without revealing sensitive request content", async () => {
  const f = await authorityFixture(h, ["case.intake", "case.review"]);
  const input = request();
  const results = await Promise.all([
    createPrivacyCase(h.db, f.actor, input, authoritySignal()),
    createPrivacyCase(h.db, f.actor, input, authoritySignal()),
  ]);
  expect(results[0]).toEqual(results[1]);
  const created = results[0];
  expect(created?.ok).toBe(true);
  if (created === undefined || !created.ok) return;
  expect(created.value.status).toBe("received");
  expect(JSON.stringify(created)).not.toContain("PRIVATE-");
  const [row] = await h.db.select().from(privacyCases).where(eq(privacyCases.id, created.value.id));
  expect(row).toBeDefined();
  if (row === undefined) return;
  expect(row.metadataEnc.toString()).not.toContain("PRIVATE-");
  const clear = decryptPrivacy(row.metadataEnc, { caseId: row.id, purpose: "intake" });
  expect(clear.ok).toBe(true);
  if (clear.ok) expect(clear.value).toContain("PRIVATE-INTAKE-SENTINEL");
  expect(
    await h.db.select().from(privacyCaseEvents).where(eq(privacyCaseEvents.caseId, row.id)),
  ).toHaveLength(1);
  expect(
    await createPrivacyCase(h.db, f.actor, { ...input, summary: "changed" }, authoritySignal()),
  ).toEqual({ ok: false, error: "idempotency_conflict" });
});

test("P03A: case commands require current version and do not promote intake authority to review", async () => {
  const f = await authorityFixture(h, ["case.intake", "case.review"]);
  const result = await createPrivacyCase(h.db, f.actor, request(), authoritySignal());
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const command = {
    caseId: result.value.id,
    expectedVersion: 1,
    commandId: randomUUID(),
    toStatus: "verification_needed",
  };
  expect(await transitionPrivacyCase(h.db, f.actor, command, authoritySignal())).toEqual({
    ok: false,
    error: "forbidden",
  });
  await h.db
    .update(privacyCaseMembers)
    .set({ capabilities: ["case.review"] })
    .where(eq(privacyCaseMembers.caseId, result.value.id));
  const next = await transitionPrivacyCase(h.db, f.actor, command, authoritySignal());
  expect(next.ok).toBe(true);
  expect(await transitionPrivacyCase(h.db, f.actor, command, authoritySignal())).toEqual(next);
  expect(
    await transitionPrivacyCase(
      h.db,
      f.actor,
      { ...command, commandId: randomUUID() },
      authoritySignal(),
    ),
  ).toEqual({ ok: false, error: "stale_version" });
  expect(
    await transitionPrivacyCase(
      h.db,
      f.actor,
      { ...command, expectedVersion: 2, commandId: randomUUID(), toStatus: "under_review" },
      authoritySignal(),
    ),
  ).toEqual({ ok: false, error: "verification_required" });
});

test("P03B/C01/C13: unverified/stale cases cannot jump to completion or accept fabricated responses", async () => {
  const f = await authorityFixture(h, ["case.review"]);
  const command = {
    caseId: f.privacyCase.id,
    expectedVersion: 1,
    commandId: randomUUID(),
    toStatus: "closed",
  };
  expect(await transitionPrivacyCase(h.db, f.actor, command, authoritySignal())).toEqual({
    ok: false,
    error: "invalid_transition",
  });
  const unrelated = await authorityFixture(h, ["case.review"]);
  expect(await transitionPrivacyCase(h.db, unrelated.actor, command, authoritySignal())).toEqual({
    ok: false,
    error: "forbidden",
  });
  expect(
    await transitionPrivacyCase(
      h.db,
      f.actor,
      { ...command, toStatus: "refused" },
      authoritySignal(),
    ),
  ).toEqual({ ok: false, error: "decision_required" });
  const refused = await transitionPrivacyCase(
    h.db,
    f.actor,
    { ...command, toStatus: "refused", reason: "SYNTHETIC-REFUSAL-REASON" },
    authoritySignal(),
  );
  expect(refused.ok).toBe(true);
  const events = await h.db
    .select()
    .from(privacyCaseEvents)
    .where(eq(privacyCaseEvents.caseId, f.privacyCase.id));
  expect(JSON.stringify(events)).not.toContain("SYNTHETIC-REFUSAL-REASON");
});

test("P03B/C11: failed evidence insertion rolls back intake and does not expose driver payloads", async () => {
  const f = await authorityFixture(h, ["case.intake"]);
  await h.pool.query(
    "CREATE FUNCTION privacy_test_fail_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'PRIVATE-DRIVER-SENTINEL' USING ERRCODE='23514'; END; $$",
  );
  await h.pool.query(
    "CREATE TRIGGER privacy_test_fail_event BEFORE INSERT ON privacy_case_events FOR EACH ROW EXECUTE FUNCTION privacy_test_fail_event()",
  );
  const input = request();
  try {
    const result = await createPrivacyCase(h.db, f.actor, input, authoritySignal());
    expect(result).toEqual({ ok: false, error: "storage_unavailable" });
    expect(JSON.stringify(result)).not.toContain("PRIVATE-");
    expect(
      await h.db.select().from(privacyCases).where(eq(privacyCases.intakeKey, input.intakeKey)),
    ).toHaveLength(0);
  } finally {
    await h.pool.query("DROP TRIGGER privacy_test_fail_event ON privacy_case_events");
    await h.pool.query("DROP FUNCTION privacy_test_fail_event()");
  }
});

test("P03B/P05B: input validation rejects substituted receipt, unknown kinds and oversized evidence", async () => {
  const f = await authorityFixture(h, ["case.intake"]);
  for (const input of [
    { ...request(), receivedAt: "2030-01-01" },
    { ...request(), kind: "purge_everything" },
    { ...request(), summary: "x".repeat(4001) },
  ]) {
    expect(await createPrivacyCase(h.db, f.actor, input, authoritySignal())).toEqual({
      ok: false,
      error: "invalid_input",
    });
  }
});

test("C03: returning a case to verification invalidates both prior and newly requested disclosure", async () => {
  const f = await authorityFixture(h, ["case.review", "case.disclose"]);
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
  const changed = await transitionPrivacyCase(
    h.db,
    f.actor,
    {
      caseId: f.privacyCase.id,
      expectedVersion: 1,
      commandId: randomUUID(),
      toStatus: "verification_needed",
    },
    authoritySignal(),
  );
  expect(changed.ok).toBe(true);
  expect(
    await withPrivacyAuthority(h.db, f.actor, request, authoritySignal(), () =>
      Promise.resolve(ok(true)),
    ),
  ).toEqual({ ok: false, error: "forbidden" });
  expect(
    await withPrivacyAuthority(
      h.db,
      f.actor,
      { ...request, expected: issued.value },
      authoritySignal(),
      () => Promise.resolve(ok(true)),
    ),
  ).toEqual({ ok: false, error: "forbidden" });
});

test("C11: real pool acquisition timeout is an operational Result without driver details", async () => {
  const f = await authorityFixture(h, ["case.intake"]);
  const pool = new Pool({ connectionString: h.url, max: 1, connectionTimeoutMillis: 50 });
  const client = await pool.connect();
  try {
    await expect(
      createPrivacyCase(drizzle(pool, { schema }), f.actor, request(), authoritySignal()),
    ).resolves.toEqual({ ok: false, error: "storage_unavailable" });
  } finally {
    client.release();
    await pool.end();
  }
});

test("P04B/C11: a verification timestamp without a current proof cannot advance review", async () => {
  const f = await authorityFixture(h, ["case.review"]);
  await h.db
    .update(privacyCases)
    .set({ status: "verification_needed" })
    .where(eq(privacyCases.id, f.privacyCase.id));
  await h.pool.query("DELETE FROM privacy_case_verifications WHERE case_id=$1", [f.privacyCase.id]);
  expect(
    await transitionPrivacyCase(
      h.db,
      f.actor,
      {
        caseId: f.privacyCase.id,
        expectedVersion: 1,
        commandId: randomUUID(),
        toStatus: "under_review",
      },
      authoritySignal(),
    ),
  ).toEqual({ ok: false, error: "verification_required" });
});
