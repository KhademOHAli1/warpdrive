import { expect, it } from "vitest";
import { activities, deals, organizations, persons } from "@/db/schema";
import { withTestDb } from "@/db/testing";
import { seedPipelineWithStages, seedUser } from "@/db/testing/factories";
import type { ImportActor } from "./commit";
import { dealPrimary, run } from "./ownersTestHelpers";
import { adminActorFor } from "./pipedriveImport.testHelpers";

it("assigns a deal and its created org and person to the matched owners", async () => {
  await withTestDb(async (db) => {
    const importer = await seedUser(db, { isAdmin: true });
    const ann = await seedUser(db, { name: "Ann Lee" });
    const bob = await seedUser(db, { email: "Bob@Example.com", name: "Bob" });
    const cat = await seedUser(db, { name: "Cat" });
    const p = await seedPipelineWithStages(db, ["Q"]);
    const { outcome, warnings } = await run(db, adminActorFor(importer.id), "deal", {
      primary: dealPrimary(p.pipeline.name, { owner: "ann lee" }),
      organization: { name: "Acme", owner: "bob@example.com" },
      person: { name: "Pat", emails: [], phones: [], owner: cat.name },
    });
    expect(outcome.ok && outcome.value.status).toBe("imported");
    expect(warnings).toEqual([]);
    const [deal] = await db.select().from(deals);
    const [org] = await db.select().from(organizations);
    const [person] = await db.select().from(persons);
    expect(deal?.ownerId).toBe(ann.id);
    expect(org?.ownerId).toBe(bob.id);
    expect(person?.ownerId).toBe(cat.id);
  });
});

it("assigns a person and an organization primary to the matched owner", async () => {
  await withTestDb(async (db) => {
    const importer = await seedUser(db, { isAdmin: true });
    const ann = await seedUser(db, { name: "Ann" });
    const actor = adminActorFor(importer.id);
    await run(db, actor, "person", {
      primary: { name: "Pat", emails: [], phones: [], customFields: {}, owner: "Ann" },
    });
    await run(db, actor, "organization", {
      primary: { name: "Acme", customFields: {}, owner: "Ann" },
    });
    const [person] = await db.select().from(persons);
    const [org] = await db.select().from(organizations);
    expect(person?.ownerId).toBe(ann.id);
    expect(org?.ownerId).toBe(ann.id);
  });
});

it("sets an activity assignee and keeps the importer as owner", async () => {
  await withTestDb(async (db) => {
    const importer = await seedUser(db, { isAdmin: true });
    const ann = await seedUser(db, { name: "Ann" });
    const { outcome } = await run(db, adminActorFor(importer.id), "activity", {
      primary: { subject: "Call", assignee: "Ann", customFields: {} },
    });
    expect(outcome.ok && outcome.value.status).toBe("imported");
    const [act] = await db.select().from(activities);
    expect(act?.assigneeId).toBe(ann.id);
    expect(act?.ownerId).toBe(importer.id);
  });
});

it("warns and keeps the importer when no user matches", async () => {
  await withTestDb(async (db) => {
    const importer = await seedUser(db, { isAdmin: true });
    const p = await seedPipelineWithStages(db, ["Q"]);
    const { warnings } = await run(db, adminActorFor(importer.id), "deal", {
      primary: dealPrimary(p.pipeline.name, { owner: "Nobody" }),
    });
    const [deal] = await db.select().from(deals);
    expect(deal?.ownerId).toBe(importer.id);
    expect(warnings).toEqual([
      { field: "owner", message: 'owner "Nobody" not assigned: no matching user' },
    ]);
  });
});

it("warns when several users share the display name", async () => {
  await withTestDb(async (db) => {
    const importer = await seedUser(db, { isAdmin: true });
    await seedUser(db, { name: "Sam" });
    await seedUser(db, { name: "sam" });
    const { warnings } = await run(db, adminActorFor(importer.id), "activity", {
      primary: { subject: "Call", assignee: "SAM", customFields: {} },
    });
    const [act] = await db.select().from(activities);
    expect(act?.assigneeId).toBe(importer.id);
    expect(warnings).toEqual([
      { field: "assignee", message: 'assignee "SAM" not assigned: several users match' },
    ]);
  });
});

it("never matches a deactivated user", async () => {
  await withTestDb(async (db) => {
    const importer = await seedUser(db, { isAdmin: true });
    await seedUser(db, { name: "Gone", isActive: false });
    const { warnings } = await run(db, adminActorFor(importer.id), "activity", {
      primary: { subject: "Call", assignee: "Gone", customFields: {} },
    });
    expect(warnings[0]?.message).toBe('assignee "Gone" not assigned: no matching user');
  });
});

it("keeps ownership with a warning when the actor may not transfer", async () => {
  await withTestDb(async (db) => {
    const importer = await seedUser(db);
    await seedUser(db, { name: "Ann" });
    const p = await seedPipelineWithStages(db, ["Q"]);
    const actor: ImportActor = {
      ...adminActorFor(importer.id),
      type: "regular",
      flags: new Set(["deal.create", "contact.create"]),
    };
    const { outcome, warnings } = await run(db, actor, "deal", {
      primary: dealPrimary(p.pipeline.name, { owner: "Ann" }),
    });
    expect(outcome.ok && outcome.value.status).toBe("imported");
    const [deal] = await db.select().from(deals);
    expect(deal?.ownerId).toBe(importer.id);
    expect(warnings).toEqual([
      { field: "owner", message: 'owner "Ann" not assigned: not permitted' },
    ]);
  });
});

it("leaves a pre-existing linked org with its owner", async () => {
  await withTestDb(async (db) => {
    const importer = await seedUser(db, { isAdmin: true });
    const keeper = await seedUser(db, { name: "Keeper" });
    await seedUser(db, { name: "Ann" });
    const p = await seedPipelineWithStages(db, ["Q"]);
    await db
      .insert(organizations)
      .values({ name: "Acme", ownerId: keeper.id, visibilityLevel: "all" });
    await run(db, adminActorFor(importer.id), "deal", {
      primary: dealPrimary(p.pipeline.name, {}),
      organization: { name: "Acme", owner: "Ann" },
    });
    const orgs = await db.select().from(organizations);
    expect(orgs).toHaveLength(1);
    expect(orgs[0]?.ownerId).toBe(keeper.id);
  });
});
