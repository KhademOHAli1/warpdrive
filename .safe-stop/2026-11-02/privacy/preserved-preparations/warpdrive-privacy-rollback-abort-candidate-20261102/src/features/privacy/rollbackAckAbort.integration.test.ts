import { afterAll, beforeAll, test } from "vitest";
import { makeTestDb, type TestDb } from "@/test/db";
import { authorityFixture } from "./authority.test-helpers";
import { identityTransaction } from "./identityTransaction";
import { withPrivacyAuthority } from "./permissions";
import { exerciseRollbackAckAbort } from "./rollbackAckAbort.test-helpers";

let h: TestDb;
beforeAll(async () => { h = await makeTestDb(); }, 20_000);
afterAll(async () => { await h.close(); }, 15_000);

test("shared saved failed Result cannot suppress the exact abort raised at actual rollback idle ACK", async ({ signal }) => {
  const fixture = await authorityFixture(h, ["case.review"]);
  await exerciseRollbackAckAbort(h, fixture, (db, operationSignal, effect) =>
    withPrivacyAuthority(db, fixture.actor,
      { capability: "case.review", caseId: fixture.privacyCase.id }, operationSignal, effect), signal);
}, 30_000);

test("private identity transaction saved failed Result cannot suppress actual rollback-ACK abort", async ({ signal }) => {
  const fixture = await authorityFixture(h, []);
  await exerciseRollbackAckAbort(h, fixture, (db, operationSignal, effect) =>
    identityTransaction(db, fixture.actor, operationSignal, effect), signal);
}, 30_000);
