import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { privacyCases } from "@/db/schema";
import { makeTestDb, type TestDb } from "@/test/db";
import { err, ok } from "@/types/result";
import { authorityFixture, authoritySignal } from "./authority.test-helpers";
import { withPrivacyAuthority } from "./permissions";

let h: TestDb;
beforeAll(async () => {
  h = await makeTestDb();
});
afterAll(async () => {
  await h.close();
});

test("an operational callback failure rolls back earlier writes before returning its Result", async () => {
  const f = await authorityFixture(h);
  const result = await withPrivacyAuthority(
    h.db,
    f.actor,
    { capability: "case.disclose", caseId: f.privacyCase.id },
    authoritySignal(),
    async (tx) => {
      await tx
        .update(privacyCases)
        .set({ unresolvedObligations: 1 })
        .where(eq(privacyCases.id, f.privacyCase.id));
      return err("synthetic_failure" as const);
    },
  );
  expect(result).toEqual({ ok: false, error: "synthetic_failure" });
  const [row] = await h.db.select().from(privacyCases).where(eq(privacyCases.id, f.privacyCase.id));
  expect(row?.unresolvedObligations).toBe(0);
});

test("abort after a local effect releases the transaction and rolls its writes back", async () => {
  const f = await authorityFixture(h);
  const controller = new AbortController();
  await expect(
    withPrivacyAuthority(
      h.db,
      f.actor,
      { capability: "case.disclose", caseId: f.privacyCase.id },
      controller.signal,
      async (tx) => {
        await tx
          .update(privacyCases)
          .set({ unresolvedObligations: 1 })
          .where(eq(privacyCases.id, f.privacyCase.id));
        controller.abort();
        return ok(true);
      },
    ),
  ).rejects.toThrow();
  const [row] = await h.db.select().from(privacyCases).where(eq(privacyCases.id, f.privacyCase.id));
  expect(row?.unresolvedObligations).toBe(0);
});
