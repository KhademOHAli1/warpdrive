import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { activities, deals } from "@/db/schema";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
import { mapExternal, runActivity, seedDeal, seedOrg } from "./activityImport.testHelpers";
import { adminActorFor } from "./pipedriveImport.testHelpers";

it("fails an unresolved ID even when the name alongside it would match", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    await seedOrg(db, user.id, "Acme");
    const r = await runActivity(db, adminActorFor(user.id), {
      orgPipedriveId: "99",
      orgName: "Acme",
    });
    expect(r.errors[0]?.message).toBe(
      "unknown Pipedrive organization 99: import organizations first",
    );
    expect(await db.select().from(activities)).toHaveLength(0);
  });
});

it("treats a mapping that points at a soft-deleted record as unknown", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const deal = await seedDeal(db, user.id, "Gone deal");
    await mapExternal(db, user.id, "deal", "11", deal.id);
    await db.update(deals).set({ deletedAt: new Date() }).where(eq(deals.id, deal.id));
    const r = await runActivity(db, adminActorFor(user.id), { dealPipedriveId: "11" });
    expect(r.errors[0]?.message).toBe("unknown Pipedrive deal 11: import deals first");
  });
});

it("reports every failing link on the row", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const r = await runActivity(db, adminActorFor(user.id), {
      dealPipedriveId: "1",
      personName: "Nobody",
    });
    expect(r.errors.map((e) => e.message)).toEqual([
      "unknown Pipedrive deal 1: import deals first",
      'unknown Pipedrive person "Nobody": import people first',
    ]);
  });
});
