import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { importExternalIds, notes } from "@/db/schema";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
import { mapExternal, seedDeal, seedOrg, seedPerson } from "./activityImport.testHelpers";
import { commitBatch } from "./batch";
import { runNote } from "./noteImport.testHelpers";
import { adminActorFor, seedBatchWithRows } from "./pipedriveImport.testHelpers";
import { undoBatch } from "./undoJob";

const signal = new AbortController().signal;

it("attaches a note with deal and person IDs to the deal and keeps its creation date", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const deal = await seedDeal(db, user.id, "Big deal");
    const person = await seedPerson(db, user.id, "Pat");
    await mapExternal(db, user.id, "deal", "11", deal.id);
    await mapExternal(db, user.id, "person", "12", person.id);
    const createdAt = "2024-03-05T10:00:00.000Z";
    const r = await runNote(db, adminActorFor(user.id), {
      dealPipedriveId: "11",
      personPipedriveId: "12",
      createdAt,
    });
    expect(r.outcome.ok && r.outcome.value.status).toBe("imported");
    const [note] = await db.select().from(notes);
    expect([note?.entityType, note?.entityId]).toEqual(["deal", deal.id]);
    expect(note?.createdAt.toISOString()).toBe(createdAt);
    expect(note?.body).toBe("Called, left voicemail");
  });
});

it("attaches a note with only a person name to that person", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const person = await seedPerson(db, user.id, "Pat Doe");
    const r = await runNote(db, adminActorFor(user.id), { personName: "pat doe" });
    expect(r.outcome.ok && r.outcome.value.status).toBe("imported");
    const [note] = await db.select().from(notes);
    expect([note?.entityType, note?.entityId]).toEqual(["person", person.id]);
  });
});

it("falls back to the organization when it is the only link", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const org = await seedOrg(db, user.id, "Acme");
    await runNote(db, adminActorFor(user.id), { orgName: "Acme" });
    const [note] = await db.select().from(notes);
    expect([note?.entityType, note?.entityId]).toEqual(["organization", org.id]);
  });
});

it("fails a note with no linked record", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const r = await runNote(db, adminActorFor(user.id), {});
    expect(r.errors[0]?.message).toBe("note has no linked record");
    expect(await db.select().from(notes)).toHaveLength(0);
  });
});

it("skips a re-run of a note it already imported", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const person = await seedPerson(db, user.id, "Pat");
    await mapExternal(db, user.id, "person", "12", person.id);
    const actor = adminActorFor(user.id);
    await runNote(db, actor, { pipedriveId: "n1", personPipedriveId: "12" });
    const again = await runNote(db, actor, { pipedriveId: "n1", personPipedriveId: "12" });
    expect(again.outcome.ok && again.outcome.value.status).toBe("skipped_duplicate");
    expect(await db.select().from(notes)).toHaveLength(1);
  });
});

it("undo soft-deletes the created note and drops its mapping", async () => {
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
    expect(
      await db.select().from(importExternalIds).where(eq(importExternalIds.entity, "note")),
    ).toHaveLength(1);

    await undoBatch(db, actor, batchId, signal);

    const [note] = await db.select().from(notes);
    expect(note?.deletedAt).not.toBeNull();
    expect(
      await db.select().from(importExternalIds).where(eq(importExternalIds.entity, "note")),
    ).toHaveLength(0);
  });
});
