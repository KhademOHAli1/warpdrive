import { expect, it } from "vitest";
import { deals, notes, organizations, persons, settings } from "@/db/schema";
import { withTestDb } from "@/db/testing";
import { seedPipelineWithStages, seedUser } from "@/db/testing/factories";
import type { ImportActor } from "./commit";
import { dealPrimary, run } from "./ownersTestHelpers";
import { adminActorFor } from "./pipedriveImport.testHelpers";

it("commits a reassigned deal row under owner-only visibility with all records landing", async () => {
  await withTestDb(async (db) => {
    await db.insert(settings).values({
      id: true,
      defaultVisibilityLevels: { deal: "owner", person: "owner", organization: "owner" },
    });
    const importer = await seedUser(db);
    const ann = await seedUser(db, { name: "Ann" });
    const p = await seedPipelineWithStages(db, ["Q"]);
    const actor: ImportActor = {
      ...adminActorFor(importer.id),
      type: "regular",
      flags: new Set(["deal.create", "contact.create", "contact.edit_own", "deal.changeOwner_any"]),
    };
    const { outcome, warnings } = await run(db, actor, "deal", {
      primary: dealPrimary(p.pipeline.name, { owner: "Ann" }),
      organization: { name: "Acme", owner: "Ann" },
      person: { name: "Pat", emails: [], phones: [], owner: "Ann" },
      note: { body: "hello" },
    });
    expect(outcome.ok && outcome.value.status).toBe("imported");
    expect(warnings).toEqual([]);
    const [deal] = await db.select().from(deals);
    expect(deal?.ownerId).toBe(ann.id);
    expect(await db.select().from(notes)).toHaveLength(1);
    const [org] = await db.select().from(organizations);
    const [person] = await db.select().from(persons);
    expect(org?.ownerId).toBe(ann.id);
    expect(person?.ownerId).toBe(ann.id);
  });
});
