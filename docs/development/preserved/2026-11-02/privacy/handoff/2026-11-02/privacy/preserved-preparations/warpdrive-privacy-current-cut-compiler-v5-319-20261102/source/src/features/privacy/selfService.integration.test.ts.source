import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import {
  privacyAuthority,
  privacyCaseEvents,
  privacyCaseMembers,
  privacyCases,
  sessions,
} from "@/db/schema";
import { makeTestDb, type TestDb } from "@/test/db";
import { authorityFixture, authoritySignal } from "./authority.test-helpers";
import { decryptPrivacy } from "./crypto";
import { verifyOwnPrivacyIdentity } from "./identitySelf";
import { createOwnPrivacyCase, readOwnPrivacyCase } from "./selfService";

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
  summary: "PRIVATE-درخواست دسترسی",
});

test("P11A: an authenticated regular user can create and self-verify only an own in-app request without reviewer authority", async () => {
  const f = await authorityFixture(h, []);
  await h.db.delete(privacyAuthority).where(eq(privacyAuthority.userId, f.user.id));
  const input = request();
  const created = await createOwnPrivacyCase(h.db, f.actor, input, authoritySignal());
  expect(created.ok).toBe(true);
  if (!created.ok) return;
  const [row] = await h.db.select().from(privacyCases).where(eq(privacyCases.id, created.value.id));
  expect(row).toMatchObject({ createdBy: f.user.id, requesterUserId: f.user.id, verifiedAt: null });
  expect(row?.metadataEnc.toString()).not.toContain("PRIVATE-");
  expect(JSON.stringify(created)).not.toContain("PRIVATE-");
  if (row === undefined) return;
  const clear = decryptPrivacy(row.metadataEnc, { caseId: row.id, purpose: "intake" });
  expect(clear.ok).toBe(true);
  if (clear.ok)
    expect(JSON.parse(clear.value)).toMatchObject({
      subject: { kind: "user", referenceId: f.user.id },
      recipient: { channel: "in_app", userId: f.user.id },
      summary: input.summary,
    });
  expect(
    await h.db.select().from(privacyCaseMembers).where(eq(privacyCaseMembers.caseId, row.id)),
  ).toEqual([]);
  const verified = await verifyOwnPrivacyIdentity(
    h.db,
    f.actor,
    { caseId: row.id, expectedVersion: 1, commandId: randomUUID() },
    authoritySignal(),
  );
  expect(verified.ok).toBe(true);
  expect(await createOwnPrivacyCase(h.db, f.actor, input, authoritySignal())).toEqual(created);
  const status = await readOwnPrivacyCase(h.db, f.actor, { caseId: row.id }, authoritySignal());
  expect(status).toMatchObject({ ok: true, value: { id: row.id, version: 2, dueAt: null } });
  expect(JSON.stringify(status)).not.toContain("PRIVATE-");
});

test("P11B: concurrent own intake is one immutable receipt, and changed input conflicts", async () => {
  const f = await authorityFixture(h, []);
  const input = request();
  const [left, right] = await Promise.all([
    createOwnPrivacyCase(h.db, f.actor, input, authoritySignal()),
    createOwnPrivacyCase(h.db, f.actor, input, authoritySignal()),
  ]);
  expect(left).toEqual(right);
  expect(left.ok).toBe(true);
  if (!left.ok) return;
  expect(
    await h.db.select().from(privacyCaseEvents).where(eq(privacyCaseEvents.caseId, left.value.id)),
  ).toHaveLength(1);
  expect(
    await createOwnPrivacyCase(h.db, f.actor, { ...input, kind: "erasure" }, authoritySignal()),
  ).toEqual({ ok: false, error: "idempotency_conflict" });
});

test("P11B: unknown, operator-created and another requester's cases are indistinguishable to personal status", async () => {
  const f = await authorityFixture(h, []);
  const other = await authorityFixture(h, []);
  const created = await createOwnPrivacyCase(h.db, other.actor, request(), authoritySignal());
  expect(created.ok).toBe(true);
  if (!created.ok) return;
  for (const caseId of [randomUUID(), f.privacyCase.id, other.privacyCase.id, created.value.id]) {
    expect(await readOwnPrivacyCase(h.db, f.actor, { caseId }, authoritySignal())).toEqual({
      ok: false,
      error: "not_found",
    });
  }
});

test("P11B: caller-supplied subject, recipient or requester cannot turn personal intake into a third-party request", async () => {
  const f = await authorityFixture(h, []);
  for (const extra of [
    { subject: { kind: "user", referenceId: randomUUID() } },
    { recipient: { channel: "email", address: "private@example.test" } },
    { requesterUserId: f.user.id },
  ]) {
    expect(
      await createOwnPrivacyCase(h.db, f.actor, { ...request(), ...extra }, authoritySignal()),
    ).toEqual({ ok: false, error: "invalid_input" });
  }
});

test("P11B: revoked or stale sessions cannot create or read personal requests", async () => {
  const f = await authorityFixture(h, []);
  const created = await createOwnPrivacyCase(h.db, f.actor, request(), authoritySignal());
  expect(created.ok).toBe(true);
  if (!created.ok) return;
  for (const change of [
    { revokedAt: new Date() },
    { revokedAt: null, freshAuthenticatedAt: new Date(0) },
  ]) {
    await h.db.update(sessions).set(change).where(eq(sessions.id, f.session.id));
    expect(await createOwnPrivacyCase(h.db, f.actor, request(), authoritySignal())).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(
      await readOwnPrivacyCase(h.db, f.actor, { caseId: created.value.id }, authoritySignal()),
    ).toEqual({ ok: false, error: "forbidden" });
  }
});
