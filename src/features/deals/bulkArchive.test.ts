import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { deals } from "@/db/schema";
import { seedPipelineWithStages, seedUser } from "@/db/testing/factories";
import type { PermSetUser } from "@/features/permissions/effective";
import { makeTestDb } from "@/test/db";
import { archiveDeals } from "./bulkArchive";

let h: Awaited<ReturnType<typeof makeTestDb>>;
const sig = () => new AbortController().signal;
beforeAll(async () => {
  h = await makeTestDb();
}, 60_000);
afterAll(async () => {
  await h.close();
});

function actor(id: string): PermSetUser {
  return { id, type: "admin", isActive: true, groupIds: new Set(), flags: new Set() };
}

async function seedDeal(ownerId: string, title: string) {
  const { pipeline, stages } = await seedPipelineWithStages(h.db, ["Qualified"]);
  const [d] = await h.db
    .insert(deals)
    .values({
      title,
      pipelineId: pipeline.id,
      stageId: stages[0]!.id,
      ownerId,
      visibilityLevel: "all",
    })
    .returning();
  if (d === undefined) throw new Error("deal insert returned undefined");
  return d;
}

async function readDeal(dealId: string) {
  const [row] = await h.db.select().from(deals).where(eq(deals.id, dealId));
  if (row === undefined) throw new Error("deal vanished");
  return row;
}

it("archives every deal in the list and returns the count", async () => {
  const u = await seedUser(h.db);
  const d1 = await seedDeal(u.id, "One");
  const d2 = await seedDeal(u.id, "Two");
  const r = await archiveDeals(
    h.db,
    actor(u.id),
    {
      dealIds: [d1.id, d2.id],
      archived: true,
      expectedWriteVersions: { [d1.id]: d1.writeVersion, [d2.id]: d2.writeVersion },
    },
    sig(),
  );
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.value.count).toBe(2);
  expect((await readDeal(d1.id)).archivedAt).not.toBeNull();
  expect((await readDeal(d2.id)).archivedAt).not.toBeNull();
});

it("skips ids that do not resolve to a deal and counts only real ones", async () => {
  const u = await seedUser(h.db);
  const d1 = await seedDeal(u.id, "Real");
  const missing = "00000000-0000-0000-0000-000000000000";
  const r = await archiveDeals(
    h.db,
    actor(u.id),
    {
      dealIds: [d1.id, missing],
      archived: true,
      expectedWriteVersions: { [d1.id]: d1.writeVersion },
    },
    sig(),
  );
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.value.count).toBe(1);
  expect((await readDeal(d1.id)).archivedAt).not.toBeNull();
});

it("keeps per-record conflicts, applies a current row once and returns its final snapshot", async () => {
  const u = await seedUser(h.db);
  const stale = await seedDeal(u.id, "Stale selection");
  const current = await seedDeal(u.id, "Current selection");
  await h.db
    .update(deals)
    .set({ title: "Concurrent winner", updatedAt: sql`${deals.updatedAt}` })
    .where(eq(deals.id, stale.id));
  const winner = await readDeal(stale.id);
  const result = await archiveDeals(
    h.db,
    actor(u.id),
    {
      dealIds: [stale.id, current.id, current.id.toUpperCase()],
      archived: true,
      expectedWriteVersions: {
        [stale.id]: stale.writeVersion,
        [current.id.toUpperCase()]: current.writeVersion.toUpperCase(),
      },
    },
    sig(),
  );
  expect(result.ok).toBe(true);
  if (!result.ok) throw result.error;
  expect(result.value.count).toBe(1);
  expect(result.value.rows.map(({ dealId, outcome }) => ({ dealId, outcome }))).toEqual([
    { dealId: stale.id, outcome: "conflict" },
    { dealId: current.id, outcome: "applied" },
  ]);
  expect(await readDeal(stale.id)).toEqual(winner);
  const stored = await readDeal(current.id);
  expect(result.value.rows[1]?.deal).toEqual(stored);
  expect(stored.writeVersion).not.toBe(current.writeVersion);
});
