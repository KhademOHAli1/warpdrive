import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { privacyCases } from "@/db/schema";
import { makeTestDb, type TestDb } from "@/test/db";
import { ok } from "@/types/result";
import { authorityFixture, authoritySignal } from "./authority.test-helpers";
import { exerciseCompletionExpiry } from "./authorityCompletionExpiry.test-helpers";
import { verifyOwnPrivacyIdentity } from "./identitySelf";
import { withPrivacyAuthority } from "./permissions";
import { createOwnPrivacyCase } from "./selfService";

let h: TestDb;
beforeAll(async () => {
  h = await makeTestDb();
}, 20_000);
afterAll(async () => {
  await h.close();
}, 15_000);
const intake = () => ({
  intakeKey: randomUUID(),
  kind: "access",
  locale: "fa",
  summary: "Synthetic native completion-expiry request",
});

test("shared authority completion after native expiry denies and rolls back the earlier case write", async ({
  signal,
}) => {
  const fixture = await authorityFixture(h, ["case.review"]);
  let writeCompleted = false;
  await exerciseCompletionExpiry(
    h,
    fixture.session.id,
    {
      relation: "privacy_jobs",
      mode: "AccessShareLock",
      queryPattern: "select %privacy_jobs%",
      caseWriteBeforeWait: true,
    },
    signal,
    (db, operationSignal) =>
      withPrivacyAuthority(
        db,
        fixture.actor,
        { capability: "case.review", caseId: fixture.privacyCase.id },
        operationSignal,
        async (tx) => {
          await tx
            .update(privacyCases)
            .set({ unresolvedObligations: 1 })
            .where(eq(privacyCases.id, fixture.privacyCase.id));
          writeCompleted = true;
          await tx.execute(sql`SELECT id FROM privacy_jobs LIMIT 1`);
          return ok(true);
        },
      ),
    () =>
      expect(writeCompleted, "the actual case write must finish before the held SELECT").toBe(true),
  );
}, 30_000);

test("own intake blocked after case insertion denies on expiry without a committed case or event", async ({
  signal,
}) => {
  const fixture = await authorityFixture(h, []);
  const input = intake();
  await exerciseCompletionExpiry(
    h,
    fixture.session.id,
    {
      relation: "privacy_case_events",
      mode: "RowExclusiveLock",
      queryPattern: "insert into %privacy_case_events%",
      caseWriteBeforeWait: true,
    },
    signal,
    (db, operationSignal) => createOwnPrivacyCase(db, fixture.actor, input, operationSignal),
  );
}, 30_000);

test("own verification blocked after entry authentication denies on expiry without proof/case/event writes", async ({
  signal,
}) => {
  const fixture = await authorityFixture(h, []);
  // The fixture's base reviewer case is not requester-owned; create a real fresh own case first.
  const created = await createOwnPrivacyCase(h.db, fixture.actor, intake(), authoritySignal());
  assert(created.ok, "SETUP: real owned intake must succeed before the verification barrier");
  const command = {
    caseId: created.value.id,
    expectedVersion: created.value.version,
    commandId: randomUUID(),
  };
  await exerciseCompletionExpiry(
    h,
    fixture.session.id,
    {
      relation: "privacy_case_verifications",
      mode: "AccessShareLock",
      queryPattern: "select %privacy_case_verifications%",
      caseWriteBeforeWait: false,
    },
    signal,
    (db, operationSignal) => verifyOwnPrivacyIdentity(db, fixture.actor, command, operationSignal),
  );
}, 30_000);
