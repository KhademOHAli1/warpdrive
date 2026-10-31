import { and, eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { importBatches, importExternalIds, importRows, persons } from "@/db/schema";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
import { commitBatch, createBatch, setMapping, validateBatch } from "./batch";
import { commitRow } from "./commit";
import { adminActorFor, personRow, seedBatchWithRows } from "./pipedriveImport.testHelpers";

const signal = new AbortController().signal;

const mappingsFor = (db: Parameters<Parameters<typeof withTestDb>[0]>[0], externalId: string) =>
  db
    .select()
    .from(importExternalIds)
    .where(
      and(eq(importExternalIds.entity, "person"), eq(importExternalIds.externalId, externalId)),
    );

it("writes a mapping on create and skips every row of a re-run without creating anything", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const actor = adminActorFor(user.id);
    const rows = [personRow("1", "Ann"), personRow("2", "Bob")];
    const first = await seedBatchWithRows(db, user.id, {
      source: "pipedrive",
      target: "person",
      rows,
    });
    await commitBatch(db, actor, first.batchId, signal);
    expect(await db.select().from(persons)).toHaveLength(2);
    expect(await mappingsFor(db, "1")).toHaveLength(1);

    for (const dedupMode of ["skip", "update"] as const) {
      const again = await seedBatchWithRows(db, user.id, {
        source: "pipedrive",
        target: "person",
        rows,
      });
      const outcomes = await Promise.all(
        again.rowIds.map((id) => commitRow(db, actor, id, "person", dedupMode, signal)),
      );
      expect(outcomes.map((o) => (o.ok ? o.value.status : "err"))).toEqual([
        "skipped_duplicate",
        "skipped_duplicate",
      ]);
    }
    expect(await db.select().from(persons)).toHaveLength(2);
    expect(await db.select().from(importExternalIds)).toHaveLength(2);
  });
});

it("commits rows in row_number order", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const actor = adminActorFor(user.id);
    const email = [{ value: "same@a.com", label: "work", primary: true }];
    const { batchId, rowIds } = await seedBatchWithRows(db, user.id, {
      source: "csv",
      target: "person",
      rows: [personRow("", "First", { emails: email }), personRow("", "Second", { emails: email })],
    });
    const setNumber = (id: string | undefined, rowNumber: number) =>
      db
        .update(importRows)
        .set({ rowNumber })
        .where(eq(importRows.id, id as string));
    await setNumber(rowIds[1], 100);
    await setNumber(rowIds[0], 2);
    await setNumber(rowIds[1], 1);
    await commitBatch(db, actor, batchId, signal);
    const names = await db.select({ name: persons.name }).from(persons);
    expect(names).toEqual([{ name: "Second" }]);
  });
});

it("creates each record once when two batches of the same file commit concurrently", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const actor = adminActorFor(user.id);
    const rows = [personRow("1", "Ann")];
    const a = await seedBatchWithRows(db, user.id, { source: "pipedrive", target: "person", rows });
    const b = await seedBatchWithRows(db, user.id, { source: "pipedrive", target: "person", rows });
    const [ra, rb] = await Promise.all([
      commitRow(db, actor, a.rowIds[0] as string, "person", "skip", signal),
      commitRow(db, actor, b.rowIds[0] as string, "person", "skip", signal),
    ]);
    expect([ra.ok, rb.ok]).toEqual([true, true]);
    expect(await db.select().from(persons)).toHaveLength(1);
    expect(await mappingsFor(db, "1")).toHaveLength(1);
  });
});

it("maps a pre-existing person on a natural-key match without taking provenance", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const actor = adminActorFor(user.id);
    const [existing] = await db
      .insert(persons)
      .values({ name: "Old", primaryEmail: "old@a.com", ownerId: user.id, visibilityLevel: "all" })
      .returning();
    const emails = [{ value: "old@a.com", label: "work", primary: true }];
    const { rowIds } = await seedBatchWithRows(db, user.id, {
      source: "pipedrive",
      target: "person",
      rows: [personRow("9", "Old", { emails })],
    });
    const r = await commitRow(db, actor, rowIds[0] as string, "person", "update", signal);
    expect(r.ok && r.value.status).toBe("imported");
    const [m] = await mappingsFor(db, "9");
    expect(m?.localId).toBe(existing?.id);
    const [row] = await db
      .select()
      .from(importRows)
      .where(eq(importRows.id, rowIds[0] as string));
    expect(row?.createdEntityId).toBeNull();
  });
});

it("never touches import_external_ids for a generic CSV batch", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const { batchId } = await seedBatchWithRows(db, user.id, {
      source: "csv",
      target: "person",
      rows: [personRow("1", "Ann")],
    });
    await commitBatch(db, adminActorFor(user.id), batchId, signal);
    expect(await db.select().from(persons)).toHaveLength(1);
    expect(await db.select().from(importExternalIds)).toHaveLength(0);
  });
});

it("rejects a blank primary Pipedrive ID end to end", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const actor = adminActorFor(user.id);
    const created = await createBatch(
      db,
      actor,
      {
        targetEntity: "person",
        filename: "p.csv",
        rows: [
          { ID: "1", Name: "Ann" },
          { ID: " ", Name: "Blank" },
        ],
      },
      signal,
    );
    if (created.ok === false) throw new Error("createBatch failed");
    const { batchId } = created.value;
    await db
      .update(importBatches)
      .set({ source: "pipedrive" })
      .where(eq(importBatches.id, batchId));
    const col = (field: string) => ({ entity: "person" as const, field, isCustom: false, key: "" });
    await setMapping(
      db,
      actor,
      batchId,
      { dedupMode: "skip", columns: { ID: col("pipedriveId"), Name: col("name") } },
      signal,
    );
    await validateBatch(db, actor, batchId, signal);
    const rows = await db
      .select()
      .from(importRows)
      .where(eq(importRows.batchId, batchId))
      .orderBy(importRows.rowNumber);
    expect(rows.map((r) => r.status)).toEqual(["valid", "invalid"]);
    await commitBatch(db, actor, batchId, signal);
    expect(await db.select().from(persons)).toHaveLength(1);
  });
});
