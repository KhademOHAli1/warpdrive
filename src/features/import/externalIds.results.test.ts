import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { importExternalIds, importRows, organizations, persons } from "@/db/schema";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
import { commitBatch, listRows } from "./batch";
import { personRow, regularActorFor, seedBatchWithRows } from "./pipedriveImport.testHelpers";

const signal = new AbortController().signal;

it("returns created ids to a reader who can see them", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const actor = regularActorFor(user.id);
    const { batchId } = await seedBatchWithRows(db, user.id, {
      source: "pipedrive",
      target: "person",
      rows: [personRow("1", "Ann")],
    });
    await commitBatch(db, actor, batchId, signal);
    const [person] = await db.select().from(persons);
    const listed = await listRows(db, actor, batchId, signal);
    expect(listed.ok && listed.value[0]?.createdEntityId).toBe(person?.id);
  });
});

it("nulls the mapped id of a skipped duplicate the importer cannot see", async () => {
  await withTestDb(async (db) => {
    const owner = await seedUser(db);
    const importer = await seedUser(db);
    const [hidden] = await db
      .insert(persons)
      .values({ name: "Hidden", ownerId: owner.id, visibilityLevel: "owner" })
      .returning();
    const seed = await seedBatchWithRows(db, owner.id, {
      source: "pipedrive",
      target: "person",
      rows: [],
    });
    await db.insert(importExternalIds).values({
      source: "pipedrive",
      entity: "person",
      externalId: "1",
      localId: hidden?.id as string,
      batchId: seed.batchId,
    });
    const { batchId, rowIds } = await seedBatchWithRows(db, importer.id, {
      source: "pipedrive",
      target: "person",
      rows: [personRow("1", "Hidden")],
    });
    const actor = regularActorFor(importer.id);
    await commitBatch(db, actor, batchId, signal);

    const [stored] = await db
      .select()
      .from(importRows)
      .where(eq(importRows.id, rowIds[0] as string));
    expect(stored?.status).toBe("skipped_duplicate");
    expect(stored?.createdEntityId).toBe(hidden?.id);
    const listed = await listRows(db, actor, batchId, signal);
    expect(listed.ok && listed.value[0]?.createdEntityId).toBeNull();
  });
});

it("nulls created ids for records that became invisible after the import, keeping stored values", async () => {
  await withTestDb(async (db) => {
    const importer = await seedUser(db);
    const other = await seedUser(db);
    const actor = regularActorFor(importer.id);
    const { batchId, rowIds } = await seedBatchWithRows(db, importer.id, {
      source: "pipedrive",
      target: "person",
      rows: [{ ...personRow("1", "Ann"), organization: { pipedriveId: "5", name: "Acme" } }],
    });
    await commitBatch(db, actor, batchId, signal);
    const [stored] = await db
      .select()
      .from(importRows)
      .where(eq(importRows.id, rowIds[0] as string));
    expect(stored?.createdEntityId).not.toBeNull();
    expect(stored?.createdOrgId).not.toBeNull();

    await db.update(persons).set({ ownerId: other.id, visibilityLevel: "owner" });
    await db.update(organizations).set({ ownerId: other.id, visibilityLevel: "owner" });

    const listed = await listRows(db, actor, batchId, signal);
    const row = listed.ok ? listed.value[0] : undefined;
    expect(row?.createdEntityId).toBeNull();
    expect(row?.createdOrgId).toBeNull();
    const [after] = await db
      .select()
      .from(importRows)
      .where(eq(importRows.id, rowIds[0] as string));
    expect(after?.createdEntityId).toBe(stored?.createdEntityId);
    expect(after?.createdOrgId).toBe(stored?.createdOrgId);
  });
});

it("returns a note id only while the note's parent record is visible", async () => {
  await withTestDb(async (db) => {
    const importer = await seedUser(db);
    const other = await seedUser(db);
    const actor = regularActorFor(importer.id);
    const { batchId } = await seedBatchWithRows(db, importer.id, {
      source: "pipedrive",
      target: "person",
      rows: [{ ...personRow("1", "Ann"), note: { body: "hello" } }],
    });
    await commitBatch(db, actor, batchId, signal);
    const [stored] = await db.select().from(importRows);
    expect(stored?.createdNoteId).not.toBeNull();

    const visible = await listRows(db, actor, batchId, signal);
    expect(visible.ok && visible.value[0]?.createdNoteId).toBe(stored?.createdNoteId);

    await db.update(persons).set({ ownerId: other.id, visibilityLevel: "owner" });
    const hidden = await listRows(db, actor, batchId, signal);
    expect(hidden.ok && hidden.value[0]?.createdNoteId).toBeNull();
    const [after] = await db.select().from(importRows);
    expect(after?.createdNoteId).toBe(stored?.createdNoteId);
  });
});
