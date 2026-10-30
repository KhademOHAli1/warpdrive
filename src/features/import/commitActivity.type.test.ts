import { expect, it } from "vitest";
import { activities, activityTypes } from "@/db/schema";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
import { runActivity } from "./activityImport.testHelpers";
import { adminActorFor } from "./pipedriveImport.testHelpers";

it("resolves a type by its display name", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const [meeting] = await db
      .insert(activityTypes)
      .values({ key: "mtg", name: "Site Visit" })
      .returning();
    const r = await runActivity(db, adminActorFor(user.id), { typeKey: "site visit" });
    expect(r.outcome.ok && r.outcome.value.status).toBe("imported");
    const [a] = await db.select().from(activities);
    expect(a?.typeId).toBe(meeting?.id);
  });
});

it("fails when two active types share the display name", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    await db.insert(activityTypes).values([
      { key: "v1", name: "Visit" },
      { key: "v2", name: "visit" },
    ]);
    const r = await runActivity(db, adminActorFor(user.id), { typeKey: "Visit" });
    expect(r.errors[0]?.message).toBe("ambiguous activity type: Visit");
  });
});

it("prefers an exact key over a name that matches another type", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const [byKey] = await db
      .insert(activityTypes)
      .values({ key: "demo", name: "Alpha" })
      .returning();
    await db.insert(activityTypes).values({ key: "other", name: "demo" });
    await runActivity(db, adminActorFor(user.id), { typeKey: "demo" });
    const [a] = await db.select().from(activities);
    expect(a?.typeId).toBe(byKey?.id);
  });
});
