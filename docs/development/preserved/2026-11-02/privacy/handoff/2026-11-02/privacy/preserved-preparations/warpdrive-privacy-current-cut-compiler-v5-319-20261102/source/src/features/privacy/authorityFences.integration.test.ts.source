import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { privacyAuthority, privacyCaseMembers, privacyCases } from "@/db/schema";
import { lockAuthAccount } from "@/features/auth/better/accountLock";
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
function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
type Fixture = Awaited<ReturnType<typeof authorityFixture>>;
const memberWhere = (f: Fixture) =>
  and(eq(privacyCaseMembers.caseId, f.privacyCase.id), eq(privacyCaseMembers.userId, f.user.id));
const mutations = [
  [
    "workspace authority generation",
    (f: Fixture) =>
      h.db
        .update(privacyAuthority)
        .set({ generation: 2 })
        .where(eq(privacyAuthority.userId, f.user.id)),
  ],
  [
    "case membership generation",
    (f: Fixture) => h.db.update(privacyCaseMembers).set({ generation: 2 }).where(memberWhere(f)),
  ],
  [
    "scope version",
    (f: Fixture) =>
      h.db
        .update(privacyCases)
        .set({ scopeVersion: 2 })
        .where(eq(privacyCases.id, f.privacyCase.id)),
  ],
  [
    "reviewed policy version",
    (f: Fixture) =>
      h.db
        .update(privacyCases)
        .set({ policyVersion: 1 })
        .where(eq(privacyCases.id, f.privacyCase.id)),
  ],
  [
    "recipient version",
    (f: Fixture) =>
      h.db
        .update(privacyCases)
        .set({ recipientVersion: 2 })
        .where(eq(privacyCases.id, f.privacyCase.id)),
  ],
  [
    "verification version",
    (f: Fixture) =>
      h.db
        .update(privacyCases)
        .set({ verificationVersion: 2 })
        .where(eq(privacyCases.id, f.privacyCase.id)),
  ],
  [
    "revoked case membership",
    (f: Fixture) =>
      h.db.update(privacyCaseMembers).set({ revokedAt: new Date() }).where(memberWhere(f)),
  ],
  [
    "withdrawn workspace capability",
    (f: Fixture) =>
      h.db
        .update(privacyAuthority)
        .set({ capabilities: [] })
        .where(eq(privacyAuthority.userId, f.user.id)),
  ],
] as const;

for (const [label, mutate] of mutations)
  test(`stored work cannot execute after changed ${label}`, async () => {
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
    await mutate(f);
    let invoked = false;
    const result = await withPrivacyAuthority(
      h.db,
      f.actor,
      { ...request, expected: issued.value },
      authoritySignal(),
      () => {
        invoked = true;
        return Promise.resolve(ok(true));
      },
    );
    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(invoked).toBe(false);
  });

test("intake may create a case, while a caller cannot disable subject verification for disclosure", async () => {
  const f = await authorityFixture(h, ["case.intake", "case.disclose"]);
  expect(
    (
      await withPrivacyAuthority(
        h.db,
        f.actor,
        { capability: "case.intake" },
        authoritySignal(),
        () => Promise.resolve(ok(true)),
      )
    ).ok,
  ).toBe(true);
  await h.db
    .update(privacyCases)
    .set({ verifiedAt: null })
    .where(eq(privacyCases.id, f.privacyCase.id));
  expect(
    await withPrivacyAuthority(
      h.db,
      f.actor,
      { capability: "case.disclose", caseId: f.privacyCase.id, requireVerifiedSubject: false },
      authoritySignal(),
      () => Promise.resolve(ok(true)),
    ),
  ).toEqual({ ok: false, error: "forbidden" });
});

test("a revocation committing while an effect waits for the account fence wins before execution", async () => {
  const f = await authorityFixture(h);
  const held = deferred();
  const release = deferred();
  const revoked = h.db.transaction(async (tx) => {
    await lockAuthAccount(tx, f.user.id, authoritySignal());
    await tx
      .update(privacyAuthority)
      .set({ capabilities: [], generation: 2 })
      .where(eq(privacyAuthority.userId, f.user.id));
    held.resolve();
    await release.promise;
  });
  await held.promise;
  let invoked = false;
  const effect = withPrivacyAuthority(
    h.db,
    f.actor,
    { capability: "case.disclose", caseId: f.privacyCase.id },
    authoritySignal(),
    () => {
      invoked = true;
      return Promise.resolve(ok(true));
    },
  );
  const polling = new AbortController();
  const waiting = (async () => {
    while (!polling.signal.aborted) {
      const rows = await h.pool.query<{ waiting: boolean }>(
        "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event='advisory') AS waiting",
      );
      if (rows.rows[0]?.waiting === true) return true;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return false;
  })();
  try {
    expect(await Promise.race([waiting, effect.then(() => false)])).toBe(true);
  } finally {
    polling.abort();
    release.resolve();
    await revoked;
    await waiting;
  }
  expect(await effect).toEqual({ ok: false, error: "forbidden" });
  expect(invoked).toBe(false);
});
