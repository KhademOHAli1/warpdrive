import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { importExternalIds, persons } from "@/db/schema";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
import { commitBatch } from "./batch";
import {
  adminActorFor,
  personRow,
  regularActorFor,
  seedBatchWithRows,
} from "./pipedriveImport.testHelpers";
import { undoBatch } from "./undoJob";

const signal = new AbortController().signal;

const emails = [{ value: "old@a.com", label: "work", primary: true }];

it("removes created records and only their mappings, keeping a matched contact's mapping", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const actor = adminActorFor(user.id);
    const [existing] = await db
      .insert(persons)
      .values({ name: "Old", primaryEmail: "old@a.com", ownerId: user.id, visibilityLevel: "all" })
      .returning();
    const { batchId } = await seedBatchWithRows(db, user.id, {
      source: "pipedrive",
      target: "person",
      rows: [personRow("1", "Old", { emails }), personRow("2", "New")],
      dedupMode: "update",
    });
    await commitBatch(db, actor, batchId, signal);
    expect(await db.select().from(importExternalIds)).toHaveLength(2);

    await undoBatch(db, actor, batchId, signal);

    const left = await db.select().from(importExternalIds);
    expect(left.map((m) => [m.externalId, m.localId])).toEqual([["1", existing?.id]]);
    const live = await db.select().from(persons).where(eq(persons.name, "Old"));
    expect(live[0]?.deletedAt).toBeNull();
  });
});

it("leaves the record and its mapping when the importer can no longer see the record", async () => {
  await withTestDb(async (db) => {
    const importer = await seedUser(db);
    const other = await seedUser(db);
    const actor = regularActorFor(importer.id);
    const { batchId } = await seedBatchWithRows(db, importer.id, {
      source: "pipedrive",
      target: "person",
      rows: [personRow("1", "Ann")],
    });
    await commitBatch(db, actor, batchId, signal);
    await db.update(persons).set({ ownerId: other.id, visibilityLevel: "owner" });

    await undoBatch(db, actor, batchId, signal);

    const [person] = await db.select().from(persons);
    expect(person?.deletedAt).toBeNull();
    expect(await db.select().from(importExternalIds)).toHaveLength(1);
  });
});

it("removes the mapping of an organization the row created as a side effect", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const actor = adminActorFor(user.id);
    const { batchId } = await seedBatchWithRows(db, user.id, {
      source: "pipedrive",
      target: "person",
      rows: [{ ...personRow("1", "Ann"), organization: { pipedriveId: "5", name: "Acme" } }],
    });
    await commitBatch(db, actor, batchId, signal);
    expect(await db.select().from(importExternalIds)).toHaveLength(2);

    await undoBatch(db, actor, batchId, signal);

    expect(await db.select().from(importExternalIds)).toHaveLength(0);
  });
});

it("keeps the mapping of a record that was already deleted before the undo ran", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const actor = adminActorFor(user.id);
    const { batchId } = await seedBatchWithRows(db, user.id, {
      source: "pipedrive",
      target: "person",
      rows: [personRow("1", "Ann")],
    });
    await commitBatch(db, actor, batchId, signal);
    await db.update(persons).set({ deletedAt: new Date() });

    await undoBatch(db, actor, batchId, signal);

    expect(await db.select().from(importExternalIds)).toHaveLength(1);
  });
});
