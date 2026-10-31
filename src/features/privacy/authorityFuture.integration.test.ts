import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { sessions, users } from "@/db/schema";
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

test.each(["freshAuthenticatedAt", "mfaVerifiedAt"] as const)(
  "C02: future-dated %s cannot authorize privacy effects",
  async (field) => {
    const f = await authorityFixture(h);
    await h.db.update(users).set({ isAdmin: true }).where(eq(users.id, f.user.id));
    await h.db
      .update(sessions)
      .set({ [field]: new Date(Date.now() + 3_600_000) })
      .where(eq(sessions.id, f.session.id));
    let effects = 0;
    expect(
      await withPrivacyAuthority(
        h.db,
        f.actor,
        { caseId: f.privacyCase.id, capability: "case.disclose" },
        authoritySignal(),
        () => {
          effects++;
          return Promise.resolve(ok(true));
        },
      ),
    ).toEqual({ ok: false, error: "forbidden" });
    expect(effects).toBe(0);
  },
);
