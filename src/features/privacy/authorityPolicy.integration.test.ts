import { afterAll, beforeAll, expect, test } from "vitest";
import { privacyPolicyState } from "@/db/schema";
import { makeTestDb, type TestDb } from "@/test/db";
import { ok } from "@/types/result";
import { authorityFixture, authoritySignal } from "./authority.test-helpers";
import { withPrivacyAuthority } from "./permissions";

let h: TestDb;
beforeAll(async () => {
  h = await makeTestDb();
});
afterAll(async () => {
  await h.close();
});

test("tickets explicitly carry unconfigured active policy and reject a subsequently changed global generation", async () => {
  const f = await authorityFixture(h);
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
  expect(issued.value).toMatchObject({ activePolicyVersion: null, policyGeneration: 0 });
  await h.db.insert(privacyPolicyState).values({ id: true, generation: 1 });
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
