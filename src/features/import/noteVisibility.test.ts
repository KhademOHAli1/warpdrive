import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { notes, persons } from "@/db/schema";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
import { mapExternal, seedPerson } from "./activityImport.testHelpers";
import { commitBatch, listRows } from "./batch";
import { adminActorFor, regularActorFor, seedBatchWithRows } from "./pipedriveImport.testHelpers";
import { undoBatch } from "./undoJob";

const signal = new AbortController().signal;

it("shows a null created id for an undone note row", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const actor = adminActorFor(user.id);
    const person = await seedPerson(db, user.id, "Pat");
    await mapExternal(db, user.id, "person", "12", person.id);
    const { batchId } = await seedBatchWithRows(db, user.id, {
      source: "pipedrive",
      target: "note",
      rows: [{ primary: { body: "Hello", pipedriveId: "n1", personPipedriveId: "12" } }],
    });
    await commitBatch(db, actor, batchId, signal);
    const before = await listRows(db, actor, batchId, signal);
    expect(before.ok && before.value[0]?.createdEntityId).not.toBeNull();

    await undoBatch(db, actor, batchId, signal);

    const after = await listRows(db, actor, batchId, signal);
    expect(after.ok && after.value[0]?.createdEntityId).toBeNull();
  });
});

it("skips a mapped note whose parent became invisible without exposing its id", async () => {
  await withTestDb(async (db) => {
    const importer = await seedUser(db);
    const other = await seedUser(db);
    const actor = regularActorFor(importer.id);
    const person = await seedPerson(db, importer.id, "Pat");
    await mapExternal(db, importer.id, "person", "12", person.id);
    const first = await seedBatchWithRows(db, importer.id, {
      source: "pipedrive",
      target: "note",
      rows: [{ primary: { body: "Hello", pipedriveId: "n1", personPipedriveId: "12" } }],
    });
    await commitBatch(db, adminActorFor(importer.id), first.batchId, signal);
    await db.update(persons).set({ ownerId: other.id, visibilityLevel: "owner" });

    const rerun = await seedBatchWithRows(db, importer.id, {
      source: "pipedrive",
      target: "note",
      rows: [{ primary: { body: "Hello", pipedriveId: "n1", personPipedriveId: "12" } }],
    });
    await commitBatch(db, actor, rerun.batchId, signal);

    expect(await db.select().from(notes).where(eq(notes.body, "Hello"))).toHaveLength(1);
    const listed = await listRows(db, actor, rerun.batchId, signal);
    expect(listed.ok && listed.value[0]?.status).toBe("skipped_duplicate");
    expect(listed.ok && listed.value[0]?.createdEntityId).toBeNull();
  });
});
