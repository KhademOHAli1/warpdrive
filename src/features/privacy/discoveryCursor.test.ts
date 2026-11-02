import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { decodeDiscoveryCursor, encodeDiscoveryCursor } from "./discoveryCursor";
import type { PrivacyAuthorityTicket } from "./permissions";

const ticket = (): PrivacyAuthorityTicket => ({
  userId: randomUUID(),
  sessionId: randomUUID(),
  caseId: randomUUID(),
  capability: "case.disclose",
  authorityGeneration: 1,
  membershipGeneration: 1,
  scopeVersion: 1,
  policyVersion: null,
  activePolicyVersion: null,
  policyGeneration: 0,
  recipientVersion: 1,
  verificationVersion: 1,
});
test("C01/C03/C10: discovery cursors bind opaque paging state to all current authority generations", () => {
  const issued = ticket();
  const caseId = issued.caseId;
  if (caseId === null) return;
  const id = randomUUID();
  const cursor = encodeDiscoveryCursor(caseId, issued, "notes", id);
  expect(cursor).not.toContain(id);
  expect(decodeDiscoveryCursor(cursor, caseId, issued)).toEqual({
    ok: true,
    value: { store: "notes", afterId: id },
  });
  for (const changed of [
    { ...issued, sessionId: randomUUID() },
    { ...issued, userId: randomUUID() },
    { ...issued, authorityGeneration: 2 },
    { ...issued, membershipGeneration: 2 },
    { ...issued, scopeVersion: 2 },
    { ...issued, policyGeneration: 1 },
    { ...issued, recipientVersion: 2 },
    { ...issued, verificationVersion: 2 },
  ])
    expect(decodeDiscoveryCursor(cursor, caseId, changed)).toEqual({
      ok: false,
      error: "forbidden",
    });
  expect(decodeDiscoveryCursor(cursor, randomUUID(), issued).ok).toBe(false);
  expect(decodeDiscoveryCursor(`${cursor}=`, caseId, issued).ok).toBe(false);
});
