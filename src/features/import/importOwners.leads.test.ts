import { expect, it } from "vitest";
import { leads, notes, settings } from "@/db/schema";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
import type { ImportActor } from "./commit";
import { run } from "./ownersTestHelpers";
import { adminActorFor } from "./pipedriveImport.testHelpers";

const leadPrimary = (extra: Record<string, unknown>) => ({
  title: "Lead",
  pipedriveId: "L1",
  value: null,
  expectedCloseDate: null,
  customFields: {},
  ...extra,
});

const regular = (
  id: string,
  flags: ImportActor["flags"] extends ReadonlySet<infer F> ? F[] : never,
): ImportActor => ({
  ...adminActorFor(id),
  type: "regular",
  flags: new Set(flags),
});

it("assigns a lead to the matched owner", async () => {
  await withTestDb(async (db) => {
    const importer = await seedUser(db, { isAdmin: true });
    const ann = await seedUser(db, { name: "Ann Lee" });
    const { outcome, warnings } = await run(db, adminActorFor(importer.id), "lead", {
      primary: leadPrimary({ owner: "ann lee" }),
    });
    expect(outcome.ok && outcome.value.status).toBe("imported");
    expect(warnings).toEqual([]);
    const [lead] = await db.select().from(leads);
    expect(lead?.ownerId).toBe(ann.id);
  });
});

it("applies the lead owner last so a side note on an owner-only lead still lands", async () => {
  await withTestDb(async (db) => {
    await db.insert(settings).values({
      id: true,
      defaultVisibilityLevels: { deal: "owner", person: "owner", organization: "owner" },
    });
    const importer = await seedUser(db);
    const ann = await seedUser(db, { name: "Ann" });
    const actor = regular(importer.id, ["deal.create", "contact.create", "deal.changeOwner_any"]);
    const { outcome, warnings } = await run(db, actor, "lead", {
      primary: leadPrimary({ owner: "Ann" }),
      note: { body: "hello" },
    });
    expect(outcome.ok && outcome.value.status).toBe("imported");
    expect(warnings).toEqual([]);
    const [lead] = await db.select().from(leads);
    expect(lead?.ownerId).toBe(ann.id);
    expect(await db.select().from(notes)).toHaveLength(1);
  });
});

it("keeps the importer with a warning when no user matches", async () => {
  await withTestDb(async (db) => {
    const importer = await seedUser(db, { isAdmin: true });
    const { warnings } = await run(db, adminActorFor(importer.id), "lead", {
      primary: leadPrimary({ owner: "Nobody" }),
    });
    const [lead] = await db.select().from(leads);
    expect(lead?.ownerId).toBe(importer.id);
    expect(warnings).toEqual([
      { field: "owner", message: 'owner "Nobody" not assigned: no matching user' },
    ]);
  });
});

it("keeps the importer with a warning when the actor may not transfer owners", async () => {
  await withTestDb(async (db) => {
    const importer = await seedUser(db);
    await seedUser(db, { name: "Ann" });
    const actor = regular(importer.id, ["deal.create", "contact.create", "contact.edit_own"]);
    const { outcome, warnings } = await run(db, actor, "lead", {
      primary: leadPrimary({ owner: "Ann" }),
    });
    expect(outcome.ok && outcome.value.status).toBe("imported");
    const [lead] = await db.select().from(leads);
    expect(lead?.ownerId).toBe(importer.id);
    expect(warnings).toEqual([
      { field: "owner", message: 'owner "Ann" not assigned: not permitted' },
    ]);
  });
});
