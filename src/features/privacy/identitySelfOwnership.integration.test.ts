import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import {
  privacyAuthority,
  privacyCaseEvents,
  privacyCases,
  privacyCaseVerifications,
} from "@/db/schema";
import { makeTestDb, type TestDb } from "@/test/db";
import { authorityFixture, authoritySignal } from "./authority.test-helpers";
import { verifyOwnPrivacyIdentity } from "./identitySelf";
import { createOwnPrivacyCase } from "./selfService";

type Fixture = Awaited<ReturnType<typeof authorityFixture>>;
let h: TestDb;
let requester: Fixture;
let unrelated: Fixture;

beforeAll(async () => {
  h = await makeTestDb();
  requester = await authorityFixture(h, []);
  unrelated = await authorityFixture(h, []);
  for (const f of [requester, unrelated]) {
    await h.db.delete(privacyAuthority).where(eq(privacyAuthority.userId, f.user.id));
    expect(f.user.isAdmin).toBe(false);
  }
});
afterAll(async () => {
  await h.close();
});

async function ownRequest() {
  const created = await createOwnPrivacyCase(
    h.db,
    requester.actor,
    {
      intakeKey: randomUUID(),
      kind: "access",
      locale: "en",
      summary: "Synthetic own identity ownership request",
    },
    authoritySignal(),
  );
  assert(created.ok, "synthetic own request creation failed");
  return created.value;
}

// The isolated fixture has at most six cases. Compare complete rows, including ciphertext,
// so an unauthorized command cannot silently create or alter a proof or immutable receipt.
async function identityState() {
  const [cases, events, proofs] = await Promise.all([
    h.db.select().from(privacyCases).orderBy(privacyCases.id),
    h.db.select().from(privacyCaseEvents).orderBy(privacyCaseEvents.id),
    h.db.select().from(privacyCaseVerifications).orderBy(privacyCaseVerifications.caseId),
  ]);
  return { cases, events, proofs };
}

async function expectUnrelatedDenied(command: {
  caseId: string;
  expectedVersion: number;
  commandId: string;
}) {
  const before = await identityState();
  const result = await verifyOwnPrivacyIdentity(h.db, unrelated.actor, command, authoritySignal());
  const after = await identityState();

  expect(result).toEqual({ ok: false, error: "forbidden" });
  expect(after).toEqual(before);
}

test("own verification of an unknown case gives uniform forbidden without writes", async () => {
  await expectUnrelatedDenied({
    caseId: randomUUID(),
    expectedVersion: 1,
    commandId: randomUUID(),
  });
});

test("another requester's received case cannot reveal its version through self-verification", async () => {
  const receipt = await ownRequest();

  await expectUnrelatedDenied({
    caseId: receipt.id,
    expectedVersion: receipt.version + 1,
    commandId: randomUUID(),
  });
});

test("another requester's closed or cancelled case cannot reveal mutability", async () => {
  for (const status of ["closed", "cancelled"] as const) {
    const receipt = await ownRequest();
    await h.db.update(privacyCases).set({ status }).where(eq(privacyCases.id, receipt.id));

    await expectUnrelatedDenied({
      caseId: receipt.id,
      expectedVersion: receipt.version,
      commandId: randomUUID(),
    });
  }
});

test("another requester's genuine verification replay cannot reveal command existence or alter its proof", async () => {
  const receipt = await ownRequest();
  const command = {
    caseId: receipt.id,
    expectedVersion: receipt.version,
    commandId: randomUUID(),
  };
  const verified = await verifyOwnPrivacyIdentity(
    h.db,
    requester.actor,
    command,
    authoritySignal(),
  );
  assert(verified.ok, "synthetic requester verification failed");
  expect(
    await h.db
      .select()
      .from(privacyCaseVerifications)
      .where(eq(privacyCaseVerifications.caseId, receipt.id)),
  ).toHaveLength(1);

  await expectUnrelatedDenied(command);
});
