import { expect, it } from "vitest";
import { activities } from "@/db/schema";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
import {
  mapExternal,
  runActivity,
  seedDeal,
  seedOrg,
  seedPerson,
} from "./activityImport.testHelpers";
import { adminActorFor, regularActorFor } from "./pipedriveImport.testHelpers";

it("links an activity to the deal, person and organization named by Pipedrive IDs", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const deal = await seedDeal(db, user.id, "Big deal");
    const person = await seedPerson(db, user.id, "Pat");
    const org = await seedOrg(db, user.id, "Acme");
    await mapExternal(db, user.id, "deal", "11", deal.id);
    await mapExternal(db, user.id, "person", "12", person.id);
    await mapExternal(db, user.id, "organization", "13", org.id);
    const r = await runActivity(db, adminActorFor(user.id), {
      dealPipedriveId: "11",
      personPipedriveId: "12",
      orgPipedriveId: "13",
    });
    expect(r.outcome.ok && r.outcome.value.status).toBe("imported");
    const [a] = await db.select().from(activities);
    expect([a?.dealId, a?.personId, a?.orgId]).toEqual([deal.id, person.id, org.id]);
  });
});

it("fails an unmapped Pipedrive ID with the import-first message", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const r = await runActivity(db, adminActorFor(user.id), { orgPipedriveId: "99" });
    expect(r.errors[0]?.message).toBe(
      "unknown Pipedrive organization 99: import organizations first",
    );
    expect(await db.select().from(activities)).toHaveLength(0);
  });
});

it("links by exact case-insensitive name when only names are mapped", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const deal = await seedDeal(db, user.id, "Big Deal");
    const person = await seedPerson(db, user.id, "Pat Doe");
    const org = await seedOrg(db, user.id, "Acme");
    const r = await runActivity(db, adminActorFor(user.id), {
      dealTitle: "big deal",
      personName: "PAT DOE",
      orgName: "acme",
    });
    expect(r.outcome.ok && r.outcome.value.status).toBe("imported");
    const [a] = await db.select().from(activities);
    expect([a?.dealId, a?.personId, a?.orgId]).toEqual([deal.id, person.id, org.id]);
  });
});

it("prefers the ID over the name when both are mapped", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const byId = await seedOrg(db, user.id, "Right Co");
    await seedOrg(db, user.id, "Wrong Co");
    await mapExternal(db, user.id, "organization", "5", byId.id);
    await runActivity(db, adminActorFor(user.id), { orgPipedriveId: "5", orgName: "Wrong Co" });
    const [a] = await db.select().from(activities);
    expect(a?.orgId).toBe(byId.id);
  });
});

it("fails a name that matches nothing, naming the value", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const r = await runActivity(db, adminActorFor(user.id), { dealTitle: "Ghost deal" });
    expect(r.errors[0]?.message).toBe('unknown Pipedrive deal "Ghost deal": import deals first');
  });
});

it("fails an ambiguous name", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    await seedPerson(db, user.id, "Sam");
    await seedPerson(db, user.id, "sam");
    const r = await runActivity(db, adminActorFor(user.id), { personName: "Sam" });
    expect(r.errors[0]?.message).toBe("ambiguous person: Sam");
  });
});

it("ignores soft-deleted records when matching names", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const live = await seedOrg(db, user.id, "Dup Co");
    const gone = await seedOrg(db, user.id, "dup co");
    const { organizations } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    await db
      .update(organizations)
      .set({ deletedAt: new Date() })
      .where(eq(organizations.id, gone.id));
    await runActivity(db, adminActorFor(user.id), { orgName: "Dup Co" });
    const [a] = await db.select().from(activities);
    expect(a?.orgId).toBe(live.id);
  });
});

it("fails the row generically when a mapped link is invisible", async () => {
  await withTestDb(async (db) => {
    const owner = await seedUser(db);
    const importer = await seedUser(db);
    const { organizations } = await import("@/db/schema");
    const [org] = await db
      .insert(organizations)
      .values({ name: "Secret", ownerId: owner.id, visibilityLevel: "owner" })
      .returning();
    await mapExternal(db, owner.id, "organization", "8", org?.id as string);
    const regular = {
      ...regularActorFor(importer.id),
      flags: new Set(["data.import", "activity.create"] as const),
    };
    const r = await runActivity(db, regular, { orgPipedriveId: "8" });
    expect(r.errors[0]?.message).toBe("linked record unavailable");
  });
});
