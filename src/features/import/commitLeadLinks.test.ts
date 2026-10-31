import { expect, it } from "vitest";
import { activities, notes } from "@/db/schema";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
import {
  mapExternal,
  runActivity,
  seedDeal,
  seedLead,
  seedPerson,
} from "./activityImport.testHelpers";
import { runNote } from "./noteImport.testHelpers";
import { adminActorFor } from "./pipedriveImport.testHelpers";

it("links an activity to the lead named by its Pipedrive ID", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const lead = await seedLead(db, user.id, "Warm lead");
    await mapExternal(db, user.id, "lead", "L1", lead.id);
    const r = await runActivity(db, adminActorFor(user.id), { leadPipedriveId: "L1" });
    expect(r.outcome.ok && r.outcome.value.status).toBe("imported");
    const [a] = await db.select().from(activities);
    expect([a?.leadId, a?.dealId]).toEqual([lead.id, null]);
  });
});

it("links an activity to a lead by exact title", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const lead = await seedLead(db, user.id, "Warm Lead");
    const r = await runActivity(db, adminActorFor(user.id), { leadTitle: "warm lead" });
    expect(r.outcome.ok && r.outcome.value.status).toBe("imported");
    const [a] = await db.select().from(activities);
    expect(a?.leadId).toBe(lead.id);
  });
});

it("fails an activity that links both a deal and a lead, naming every supplied field", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const deal = await seedDeal(db, user.id, "Big deal");
    const lead = await seedLead(db, user.id, "Warm lead");
    await mapExternal(db, user.id, "deal", "11", deal.id);
    await mapExternal(db, user.id, "lead", "L1", lead.id);
    const r = await runActivity(db, adminActorFor(user.id), {
      dealPipedriveId: "11",
      leadPipedriveId: "L1",
      leadTitle: "Warm lead",
    });
    expect(r.outcome.ok && r.outcome.value.status).toBe("invalid");
    expect(r.errors).toEqual([
      { field: "dealPipedriveId", message: "activity links both a deal and a lead" },
      { field: "leadPipedriveId", message: "activity links both a deal and a lead" },
      { field: "leadTitle", message: "activity links both a deal and a lead" },
    ]);
    expect(await db.select().from(activities)).toHaveLength(0);
  });
});

it("fails a lead ID that has not been imported yet", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const r = await runActivity(db, adminActorFor(user.id), { leadPipedriveId: "L9" });
    expect(r.errors[0]?.message).toBe("unknown Pipedrive lead L9: import leads first");
    expect(r.errors[0]?.field).toBe("leadPipedriveId");
  });
});

it("attaches a note with lead and person IDs to the lead", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const lead = await seedLead(db, user.id, "Warm lead");
    const person = await seedPerson(db, user.id, "Pat");
    await mapExternal(db, user.id, "lead", "L1", lead.id);
    await mapExternal(db, user.id, "person", "12", person.id);
    await runNote(db, adminActorFor(user.id), { leadPipedriveId: "L1", personPipedriveId: "12" });
    const [note] = await db.select().from(notes);
    expect([note?.entityType, note?.entityId]).toEqual(["lead", lead.id]);
  });
});

it("attaches a note with deal and lead IDs to the deal", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const lead = await seedLead(db, user.id, "Warm lead");
    const deal = await seedDeal(db, user.id, "Big deal");
    await mapExternal(db, user.id, "lead", "L1", lead.id);
    await mapExternal(db, user.id, "deal", "11", deal.id);
    await runNote(db, adminActorFor(user.id), { leadPipedriveId: "L1", dealPipedriveId: "11" });
    const [note] = await db.select().from(notes);
    expect([note?.entityType, note?.entityId]).toEqual(["deal", deal.id]);
  });
});
