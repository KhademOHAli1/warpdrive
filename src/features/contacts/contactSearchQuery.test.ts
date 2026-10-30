import { expect, it } from "vitest";
import { organizations, persons } from "@/db/schema";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
import { listPeople } from "./listPeople";
import { listOrgs } from "./orgsRepo";
import type { ContactActor } from "./personsRepo";

function actor(id: string): ContactActor {
  return {
    id,
    type: "regular",
    isActive: true,
    groupIds: new Set(),
    flags: new Set(),
    primaryVisibilityGroupId: null,
  };
}

it("searches beyond the initial page, narrows OR filters, and never counts hidden people", async () => {
  await withTestDb(async (db) => {
    const me = await seedUser(db);
    const other = await seedUser(db);
    await db.insert(persons).values([
      ...Array.from({ length: 55 }, (_, index) => ({
        name: `A person ${index}`,
        primaryEmail: `first${index}@example.com`,
        ownerId: me.id,
        visibilityLevel: "all" as const,
      })),
      {
        name: "Z target",
        primaryEmail: "needle@example.com",
        ownerId: me.id,
        visibilityLevel: "all",
      },
      {
        name: "Hidden target",
        primaryEmail: "needle@example.com",
        ownerId: other.id,
        visibilityLevel: "owner",
      },
      { name: "Other", primaryEmail: "needle@example.com", ownerId: me.id, visibilityLevel: "all" },
    ]);
    const result = await listPeople(
      db,
      actor(me.id),
      {
        offset: 0,
        limit: 50,
        search: "NEEDLE",
        filter: {
          combinator: "or",
          conditions: [
            { field: "name", op: "contains", value: "target" },
            { field: "name", op: "contains", value: "absent" },
          ],
        },
      },
      AbortSignal.timeout(8000),
    );
    expect(result.rows.map((row) => row.name)).toEqual(["Z target"]);
    expect(result.total).toBe(1);
  });
});

it("searches organization names and industries with literal percent signs and visibility gating", async () => {
  await withTestDb(async (db) => {
    const me = await seedUser(db);
    const other = await seedUser(db);
    await db.insert(organizations).values([
      { name: "50% Labs", industry: "Software", ownerId: me.id, visibilityLevel: "all" },
      { name: "500 Labs", industry: "Manufacturing", ownerId: me.id, visibilityLevel: "all" },
      {
        name: "Hidden 50% Labs",
        industry: "Software",
        ownerId: other.id,
        visibilityLevel: "owner",
      },
    ]);
    const percent = await listOrgs(
      db,
      actor(me.id),
      { offset: 0, limit: 50, search: "50%" },
      AbortSignal.timeout(8000),
    );
    expect(percent.rows.map((row) => row.name)).toEqual(["50% Labs"]);
    expect(percent.total).toBe(1);
    const industry = await listOrgs(
      db,
      actor(me.id),
      { offset: 0, limit: 50, search: "manufacturing" },
      AbortSignal.timeout(8000),
    );
    expect(industry.rows.map((row) => row.name)).toEqual(["500 Labs"]);
  });
});
