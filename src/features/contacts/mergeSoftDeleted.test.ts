import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import { importExternalIds, organizations, persons } from "@/db/schema";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
import { personRow, seedBatchWithRows } from "@/features/import/pipedriveImport.testHelpers";
import { mergeOrgs, mergePersons } from "./merge";
import { adminActor } from "./mergeTestActors";

const signal = new AbortController().signal;

async function seedMappedPair(
  db: Parameters<typeof seedUser>[0],
  entity: "person" | "organization",
) {
  const user = await seedUser(db);
  const { batchId } = await seedBatchWithRows(db, user.id, {
    source: "pipedrive",
    target: "person",
    rows: [personRow("1", "Ann")],
  });
  const table = entity === "person" ? persons : organizations;
  const [survivor] = await db
    .insert(table)
    .values({ name: "Survivor", ownerId: user.id, visibilityLevel: "all" })
    .returning();
  const [source] = await db
    .insert(table)
    .values({ name: "Source", ownerId: user.id, visibilityLevel: "all" })
    .returning();
  if (survivor === undefined || source === undefined) throw new Error("seed failed");
  await db.insert(importExternalIds).values([
    { source: "pipedrive", entity, externalId: "s", localId: survivor.id, batchId },
    { source: "pipedrive", entity, externalId: "m", localId: source.id, batchId },
  ]);
  await db.update(table).set({ deletedAt: new Date() }).where(eq(table.id, survivor.id));
  return { user, survivor, source };
}

async function mappingTargets(db: Parameters<typeof seedUser>[0]): Promise<Record<string, string>> {
  const rows = await db.select().from(importExternalIds);
  return Object.fromEntries(rows.map((r) => [r.externalId, r.localId]));
}

it("refuses a person merge whose survivor was soft-deleted and keeps the source and its mapping", async () => {
  await withTestDb(async (db) => {
    const { user, survivor, source } = await seedMappedPair(db, "person");
    const r = await mergePersons(
      db,
      adminActor(user.id),
      { survivorId: survivor.id, mergedId: source.id, fieldChoices: { name: "Survivor" } },
      signal,
    );
    expect(r.ok).toBe(false);
    if (r.ok === true) return;
    expect(r.error.id).toBe(ERROR_IDS.CONTACT_NOT_FOUND);
    const [after] = await db.select().from(persons).where(eq(persons.id, source.id));
    expect(after?.deletedAt).toBeNull();
    expect(await mappingTargets(db)).toEqual({ s: survivor.id, m: source.id });
  });
});

it("refuses an organization merge whose survivor was soft-deleted and keeps the source and its mapping", async () => {
  await withTestDb(async (db) => {
    const { user, survivor, source } = await seedMappedPair(db, "organization");
    const r = await mergeOrgs(
      db,
      adminActor(user.id),
      { survivorId: survivor.id, mergedId: source.id, fieldChoices: { name: "Survivor" } },
      signal,
    );
    expect(r.ok).toBe(false);
    if (r.ok === true) return;
    expect(r.error.id).toBe(ERROR_IDS.CONTACT_NOT_FOUND);
    const [after] = await db.select().from(organizations).where(eq(organizations.id, source.id));
    expect(after?.deletedAt).toBeNull();
    expect(await mappingTargets(db)).toEqual({ s: survivor.id, m: source.id });
  });
});

it("refuses a person merge whose source was soft-deleted", async () => {
  await withTestDb(async (db) => {
    const { user, survivor, source } = await seedMappedPair(db, "person");
    await db.update(persons).set({ deletedAt: null }).where(eq(persons.id, survivor.id));
    await db.update(persons).set({ deletedAt: new Date() }).where(eq(persons.id, source.id));
    const r = await mergePersons(
      db,
      adminActor(user.id),
      { survivorId: survivor.id, mergedId: source.id, fieldChoices: { name: "Survivor" } },
      signal,
    );
    expect(r.ok).toBe(false);
    expect(await mappingTargets(db)).toEqual({ s: survivor.id, m: source.id });
  });
});
