import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { privacyCaseEvents, privacyCases, privacyCaseVerifications } from "@/db/schema";
import { makeTestDb, type TestDb } from "@/test/db";
import { ok } from "@/types/result";
import { authoritySignal } from "./authority.test-helpers";
import { decryptPrivacy } from "./crypto";
import {
  changePrivacyCaseRecipient,
  privacyIntakeAcknowledgement,
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

test("P04A: operator-attested trusted-channel receipt verifies only its reviewed case/recipient binding", async () => {
  const f = await identityFixture(h);
  const input = operatorVerification(f.privacyCase.id);
  expect(
    await withPrivacyAuthority(
      h.db,
      f.actor,
      { capability: "case.disclose", caseId: f.privacyCase.id },
      authoritySignal(),
      () => Promise.resolve(ok(true)),
    ),
  ).toEqual({ ok: false, error: "forbidden" });
  const verified = await verifyPrivacyCaseIdentity(h.db, f.actor, input, authoritySignal());
  expect(verified.ok).toBe(true);
  expect(JSON.stringify(verified)).not.toContain("PRIVATE-");
  const [proof] = await h.db
    .select()
    .from(privacyCaseVerifications)
    .where(eq(privacyCaseVerifications.caseId, f.privacyCase.id));
  expect(proof).toMatchObject({
    method: "operator_review",
    verifiedBy: f.user.id,
    scopeVersion: 2,
    recipientVersion: 2,
    verificationVersion: 2,
    revokedAt: null,
  });
  expect(JSON.stringify(proof)).not.toContain("PRIVATE-");
  if (proof?.evidenceEnc === null || proof === undefined) return;
  const evidence = decryptPrivacy(proof.evidenceEnc, {
    caseId: f.privacyCase.id,
    purpose: "identity",
  });
  expect(evidence.ok).toBe(true);
  if (evidence.ok) expect(evidence.value).toContain("PRIVATE-EXTERNAL-CHECK-REFERENCE");
  expect(
    (
      await withPrivacyAuthority(
        h.db,
        f.actor,
        { capability: "case.disclose", caseId: f.privacyCase.id },
        authoritySignal(),
        () => Promise.resolve(ok(true)),
      )
    ).ok,
  ).toBe(true);
  expect(await verifyPrivacyCaseIdentity(h.db, f.actor, input, authoritySignal())).toEqual(
    verified,
  );
  expect(
    await verifyPrivacyCaseIdentity(
      h.db,
      f.actor,
      { ...input, recipient: { channel: "email", address: "substituted@example.test" } },
      authoritySignal(),
    ),
  ).toEqual({ ok: false, error: "idempotency_conflict" });
});

test("P04B: recipient change clears verification, revokes the old proof and fences every old ticket", async () => {
  const f = await identityFixture(h);
  const verified = await verifyPrivacyCaseIdentity(
    h.db,
    f.actor,
    operatorVerification(f.privacyCase.id),
    authoritySignal(),
  );
  expect(verified.ok).toBe(true);
  if (!verified.ok) return;
  const issued = await withPrivacyAuthority(
    h.db,
    f.actor,
    { capability: "case.disclose", caseId: f.privacyCase.id },
    authoritySignal(),
    (_tx, ticket) => Promise.resolve(ok(ticket)),
  );
  expect(issued.ok).toBe(true);
  if (!issued.ok) return;
  const changed = await changePrivacyCaseRecipient(
    h.db,
    f.actor,
    {
      caseId: f.privacyCase.id,
      expectedVersion: verified.value.version,
      commandId: randomUUID(),
      recipient: { channel: "email", address: "replacement@example.test" },
      reason: "Trusted recipient correction",
    },
    authoritySignal(),
  );
  expect(changed.ok).toBe(true);
  const [row] = await h.db.select().from(privacyCases).where(eq(privacyCases.id, f.privacyCase.id));
  expect(row).toMatchObject({ verifiedAt: null, recipientVersion: 3, verificationVersion: 3 });
  const [proof] = await h.db
    .select()
    .from(privacyCaseVerifications)
    .where(eq(privacyCaseVerifications.caseId, f.privacyCase.id));
  expect(proof?.revokedAt).not.toBeNull();
  expect(
    await withPrivacyAuthority(
      h.db,
      f.actor,
      { capability: "case.disclose", caseId: f.privacyCase.id, expected: issued.value },
      authoritySignal(),
      () => Promise.resolve(ok(true)),
    ),
  ).toEqual({ ok: false, error: "forbidden" });
  const events = await h.db
    .select()
    .from(privacyCaseEvents)
    .where(eq(privacyCaseEvents.caseId, f.privacyCase.id));
  expect(events).toHaveLength(2);
  expect(JSON.stringify(events)).not.toContain("replacement@example.test");
});

test("P04A/P04B: authenticated self verification binds only the same user and in-app recipient", async () => {
  const f = await identityFixture(h);
  const command = { caseId: f.privacyCase.id, expectedVersion: 1, commandId: randomUUID() };
  expect(await verifyOwnPrivacyIdentity(h.db, f.actor, command, authoritySignal())).toEqual({
    ok: false,
    error: "forbidden",
  });
  await h.db
    .update(privacyCases)
    .set({ requesterUserId: f.user.id })
    .where(eq(privacyCases.id, f.privacyCase.id));
  const verified = await verifyOwnPrivacyIdentity(h.db, f.actor, command, authoritySignal());
  expect(verified.ok).toBe(true);
  expect(await verifyOwnPrivacyIdentity(h.db, f.actor, command, authoritySignal())).toEqual(
    verified,
  );
  expect(
    await verifyOwnPrivacyIdentity(
      h.db,
      f.actor,
      { ...command, subject: { kind: "user", referenceId: randomUUID() } },
      authoritySignal(),
    ),
  ).toEqual({ ok: false, error: "invalid_input" });
  const [proof] = await h.db
    .select()
    .from(privacyCaseVerifications)
    .where(eq(privacyCaseVerifications.caseId, f.privacyCase.id));
  expect(proof).toMatchObject({
    subjectKind: "user",
    subjectReferenceId: f.user.id,
    method: "authenticated_self",
  });
});

test("P04B: public acknowledgement is constant and contains no subject matches or delivery credential", () => {
  expect(privacyIntakeAcknowledgement()).toEqual({ accepted: true });
});

test("a verifiedAt timestamp without a current subject/recipient proof cannot authorize disclosure", async () => {
  const f = await identityFixture(h);
  await h.db
    .update(privacyCases)
    .set({ verifiedAt: new Date() })
    .where(eq(privacyCases.id, f.privacyCase.id));
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
