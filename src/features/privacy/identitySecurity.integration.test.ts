import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import {
  persons,
  privacyAuthority,
  privacyCaseEvents,
  privacyCases,
  privacyCaseVerifications,
} from "@/db/schema";
import { makeTestDb, type TestDb } from "@/test/db";
import { ok } from "@/types/result";
import { authoritySignal } from "./authority.test-helpers";
import {
  changePrivacyCaseRecipient,
  verifyOwnPrivacyIdentity,
  verifyPrivacyCaseIdentity,
} from "./identity";
import { identityFixture, operatorVerification } from "./identity.test-helpers";
import { withPrivacyAuthority } from "./permissions";

let h: TestDb;
beforeAll(async () => {
  h = await makeTestDb();
});
afterAll(async () => {
  await h.close();
});

test("incomplete, future, oversized and document-upload attestations deny without changing case state", async () => {
  const f = await identityFixture(h);
  const command = operatorVerification(f.privacyCase.id);
  for (const input of [
    { ...command, evidence: { ...command.evidence, confirmedRecipient: false } },
    {
      ...command,
      evidence: { ...command.evidence, observedAt: new Date(Date.now() + 3_600_000).toISOString() },
    },
    { ...command, evidence: { ...command.evidence, evidenceRef: "x".repeat(241) } },
    { ...command, identityDocument: "PRIVATE-DOCUMENT" },
  ])
    expect(await verifyPrivacyCaseIdentity(h.db, f.actor, input, authoritySignal())).toEqual({
      ok: false,
      error: "invalid_input",
    });
  const [row] = await h.db.select().from(privacyCases).where(eq(privacyCases.id, f.privacyCase.id));
  expect(row).toMatchObject({ version: 1, verifiedAt: null });
});

test("substituted case IDs and reviewers cannot verify another assigned request", async () => {
  const f = await identityFixture(h);
  const other = await identityFixture(h);
  expect(
    await verifyPrivacyCaseIdentity(
      h.db,
      other.actor,
      operatorVerification(f.privacyCase.id),
      authoritySignal(),
    ),
  ).toEqual({ ok: false, error: "forbidden" });
  expect(
    await verifyPrivacyCaseIdentity(
      h.db,
      f.actor,
      operatorVerification(randomUUID()),
      authoritySignal(),
    ),
  ).toEqual({ ok: false, error: "forbidden" });
});

test("review binds one explicit contact without merging shared addresses or treating its owner as the subject", async () => {
  const f = await identityFixture(h);
  const contacts = await h.db
    .insert(persons)
    .values([
      {
        name: "Synthetic first person",
        primaryEmail: "shared@example.test",
        ownerId: f.user.id,
        visibilityLevel: "owner" as const,
      },
      {
        name: "Synthetic second person",
        primaryEmail: "shared@example.test",
        ownerId: f.user.id,
        visibilityLevel: "owner" as const,
      },
    ])
    .returning();
  const chosen = contacts[1];
  expect(chosen).toBeDefined();
  if (chosen === undefined) return;
  const result = await verifyPrivacyCaseIdentity(
    h.db,
    f.actor,
    {
      ...operatorVerification(f.privacyCase.id),
      subject: { kind: "contact", referenceId: chosen.id },
    },
    authoritySignal(),
  );
  expect(result.ok).toBe(true);
  const [proof] = await h.db
    .select()
    .from(privacyCaseVerifications)
    .where(eq(privacyCaseVerifications.caseId, f.privacyCase.id));
  expect(proof).toMatchObject({ subjectKind: "contact", subjectReferenceId: chosen.id });
  expect(await h.db.select().from(persons)).toHaveLength(2);
  expect(proof?.subjectReferenceId).not.toBe(f.user.id);
});

test("duplicate verification produces one receipt and stale commands cannot overwrite the reviewed binding", async () => {
  const f = await identityFixture(h);
  const command = operatorVerification(f.privacyCase.id);
  const results = await Promise.all([
    verifyPrivacyCaseIdentity(h.db, f.actor, command, authoritySignal()),
    verifyPrivacyCaseIdentity(h.db, f.actor, command, authoritySignal()),
  ]);
  expect(results[0]?.ok).toBe(true);
  expect(results[0]).toEqual(results[1]);
  expect(
    await h.db
      .select()
      .from(privacyCaseEvents)
      .where(eq(privacyCaseEvents.caseId, f.privacyCase.id)),
  ).toHaveLength(1);
  expect(
    await verifyPrivacyCaseIdentity(
      h.db,
      f.actor,
      { ...command, commandId: randomUUID() },
      authoritySignal(),
    ),
  ).toEqual({ ok: false, error: "stale_version" });
});

test("revoked or unauthenticated ciphertext proof cannot satisfy a remaining case timestamp", async () => {
  const f = await identityFixture(h);
  expect(
    (
      await verifyPrivacyCaseIdentity(
        h.db,
        f.actor,
        operatorVerification(f.privacyCase.id),
        authoritySignal(),
      )
    ).ok,
  ).toBe(true);
  await h.db
    .update(privacyCaseVerifications)
    .set({ evidenceEnc: Buffer.from("PRIVATE-CORRUPT-PROOF") })
    .where(eq(privacyCaseVerifications.caseId, f.privacyCase.id));
  expect(
    await withPrivacyAuthority(
      h.db,
      f.actor,
      { capability: "case.disclose", caseId: f.privacyCase.id },
      authoritySignal(),
      () => Promise.resolve(ok(true)),
    ),
  ).toEqual({ ok: false, error: "forbidden" });
});

test("failed immutable receipt insertion rolls back proof and case, with no driver payload disclosure", async () => {
  const f = await identityFixture(h);
  await h.pool.query(
    "CREATE FUNCTION privacy_identity_fail_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'PRIVATE-IDENTITY-DRIVER' USING ERRCODE='23514'; END; $$",
  );
  await h.pool.query(
    "CREATE TRIGGER privacy_identity_fail_receipt BEFORE INSERT ON privacy_case_events FOR EACH ROW EXECUTE FUNCTION privacy_identity_fail_receipt()",
  );
  try {
    expect(
      await verifyPrivacyCaseIdentity(
        h.db,
        f.actor,
        operatorVerification(f.privacyCase.id),
        authoritySignal(),
      ),
    ).toEqual({ ok: false, error: "storage_unavailable" });
    expect(
      await h.db
        .select()
        .from(privacyCaseVerifications)
        .where(eq(privacyCaseVerifications.caseId, f.privacyCase.id)),
    ).toHaveLength(0);
    const [row] = await h.db
      .select()
      .from(privacyCases)
      .where(eq(privacyCases.id, f.privacyCase.id));
    expect(row).toMatchObject({ version: 1, verifiedAt: null });
  } finally {
    await h.pool.query("DROP TRIGGER privacy_identity_fail_receipt ON privacy_case_events");
    await h.pool.query("DROP FUNCTION privacy_identity_fail_receipt()");
  }
});

test("same-user verification needs no reviewer grants and cannot override a newly changed recipient", async () => {
  const f = await identityFixture(h);
  await h.db
    .update(privacyCases)
    .set({ requesterUserId: f.user.id })
    .where(eq(privacyCases.id, f.privacyCase.id));
  const changed = await changePrivacyCaseRecipient(
    h.db,
    f.actor,
    {
      caseId: f.privacyCase.id,
      expectedVersion: 1,
      commandId: randomUUID(),
      recipient: { channel: "email", address: "new-recipient@example.test" },
      reason: "Synthetic recipient review",
    },
    authoritySignal(),
  );
  expect(changed.ok).toBe(true);
  if (!changed.ok) return;
  await h.db.delete(privacyAuthority).where(eq(privacyAuthority.userId, f.user.id));
  expect(
    await verifyOwnPrivacyIdentity(
      h.db,
      f.actor,
      { caseId: f.privacyCase.id, expectedVersion: changed.value.version, commandId: randomUUID() },
      authoritySignal(),
    ),
  ).toEqual({ ok: false, error: "forbidden" });
});

test("fresh authenticated self-service verifies only its trusted requester binding without reviewer grants", async () => {
  const f = await identityFixture(h);
  await h.db
    .update(privacyCases)
    .set({ requesterUserId: f.user.id })
    .where(eq(privacyCases.id, f.privacyCase.id));
  await h.db.delete(privacyAuthority).where(eq(privacyAuthority.userId, f.user.id));
  expect(
    (
      await verifyOwnPrivacyIdentity(
        h.db,
        f.actor,
        { caseId: f.privacyCase.id, expectedVersion: 1, commandId: randomUUID() },
        authoritySignal(),
      )
    ).ok,
  ).toBe(true);
});

test("nonexistent explicit user/contact references cannot establish subject verification", async () => {
  const f = await identityFixture(h);
  for (const kind of ["user", "contact"])
    expect(
      await verifyPrivacyCaseIdentity(
        h.db,
        f.actor,
        { ...operatorVerification(f.privacyCase.id), subject: { kind, referenceId: randomUUID() } },
        authoritySignal(),
      ),
    ).toEqual({ ok: false, error: "forbidden" });
});

test("a rejected self-verification case write rolls back its already prepared proof", async () => {
  const f = await identityFixture(h);
  await h.db
    .update(privacyCases)
    .set({ requesterUserId: f.user.id })
    .where(eq(privacyCases.id, f.privacyCase.id));
  await h.pool.query(
    "CREATE FUNCTION privacy_identity_skip_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END; $$",
  );
  await h.pool.query(
    "CREATE TRIGGER privacy_identity_skip_update BEFORE UPDATE ON privacy_cases FOR EACH ROW EXECUTE FUNCTION privacy_identity_skip_update()",
  );
  try {
    expect(
      await verifyOwnPrivacyIdentity(
        h.db,
        f.actor,
        { caseId: f.privacyCase.id, expectedVersion: 1, commandId: randomUUID() },
        authoritySignal(),
      ),
    ).toEqual({ ok: false, error: "storage_unavailable" });
    expect(
      await h.db
        .select()
        .from(privacyCaseVerifications)
        .where(eq(privacyCaseVerifications.caseId, f.privacyCase.id)),
    ).toHaveLength(0);
  } finally {
    await h.pool.query("DROP TRIGGER privacy_identity_skip_update ON privacy_cases");
    await h.pool.query("DROP FUNCTION privacy_identity_skip_update()");
  }
});
