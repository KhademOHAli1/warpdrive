import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { importExternalIds, importRows, organizations, persons } from "@/db/schema";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
import { commitRow } from "./commit";
import {
  adminActorFor,
  personRow,
  regularActorFor,
  seedBatchWithRows,
} from "./pipedriveImport.testHelpers";

const signal = new AbortController().signal;

const orgOnlyRow = (pipedriveId: string, name?: string) => ({
  ...personRow("50", "Pat"),
  organization: name === undefined ? { pipedriveId } : { pipedriveId, name },
});

it("links to the mapped organization when the row carries only its Pipedrive ID", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const actor = adminActorFor(user.id);
    const [org] = await db
      .insert(organizations)
      .values({ name: "Mapped Co", ownerId: user.id, visibilityLevel: "all" })
      .returning();
    await db.insert(importExternalIds).values({
      source: "pipedrive",
      entity: "organization",
      externalId: "7",
      localId: org?.id as string,
      batchId: (
        await seedBatchWithRows(db, user.id, {
          source: "pipedrive",
          target: "organization",
          rows: [],
        })
      ).batchId,
    });
    const { rowIds } = await seedBatchWithRows(db, user.id, {
      source: "pipedrive",
      target: "person",
      rows: [orgOnlyRow("7")],
    });
    const r = await commitRow(db, actor, rowIds[0] as string, "person", "skip", signal);
    expect(r.ok && r.value.status).toBe("imported");
    const [p] = await db.select().from(persons);
    expect(p?.orgId).toBe(org?.id);
    expect(await db.select().from(organizations)).toHaveLength(1);
  });
});

it("fails the row generically on an invisible mapped organization and leaves the mapping", async () => {
  await withTestDb(async (db) => {
    const owner = await seedUser(db);
    const importer = await seedUser(db);
    const [org] = await db
      .insert(organizations)
      .values({ name: "Secret Co", ownerId: owner.id, visibilityLevel: "owner" })
      .returning();
    const seed = await seedBatchWithRows(db, owner.id, {
      source: "pipedrive",
      target: "organization",
      rows: [],
    });
    await db.insert(importExternalIds).values({
      source: "pipedrive",
      entity: "organization",
      externalId: "7",
      localId: org?.id as string,
      batchId: seed.batchId,
    });
    const { rowIds } = await seedBatchWithRows(db, importer.id, {
      source: "pipedrive",
      target: "person",
      rows: [orgOnlyRow("7", "Secret Co")],
    });
    const r = await commitRow(
      db,
      regularActorFor(importer.id),
      rowIds[0] as string,
      "person",
      "skip",
      signal,
    );
    expect(r.ok && r.value.status).toBe("invalid");
    const [row] = await db
      .select()
      .from(importRows)
      .where(eq(importRows.id, rowIds[0] as string));
    expect(row?.errors).toEqual([
      { field: "organization.pipedriveId", message: "linked record unavailable" },
    ]);
    expect(await db.select().from(organizations)).toHaveLength(1);
    expect(await db.select().from(persons)).toHaveLength(0);
    const maps = await db.select().from(importExternalIds);
    expect(maps).toHaveLength(1);
    expect(maps[0]?.localId).toBe(org?.id);
  });
});

it("fails the row when a Pipedrive ID has no mapping and no name to create from", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const { rowIds } = await seedBatchWithRows(db, user.id, {
      source: "pipedrive",
      target: "person",
      rows: [orgOnlyRow("404")],
    });
    const r = await commitRow(
      db,
      adminActorFor(user.id),
      rowIds[0] as string,
      "person",
      "skip",
      signal,
    );
    expect(r.ok && r.value.status).toBe("invalid");
    const [row] = await db
      .select()
      .from(importRows)
      .where(eq(importRows.id, rowIds[0] as string));
    expect(row?.errors[0]?.field).toBe("organization.pipedriveId");
    expect(row?.errors[0]?.message).toContain("404");
    expect(await db.select().from(importExternalIds)).toHaveLength(0);
  });
});

it("find-or-creates from the name and rewrites a deleted mapping", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const actor = adminActorFor(user.id);
    const [gone] = await db
      .insert(organizations)
      .values({ name: "Gone Co", ownerId: user.id, visibilityLevel: "all", deletedAt: new Date() })
      .returning();
    const seed = await seedBatchWithRows(db, user.id, {
      source: "pipedrive",
      target: "organization",
      rows: [],
    });
    await db.insert(importExternalIds).values({
      source: "pipedrive",
      entity: "organization",
      externalId: "7",
      localId: gone?.id as string,
      batchId: seed.batchId,
    });
    const { batchId, rowIds } = await seedBatchWithRows(db, user.id, {
      source: "pipedrive",
      target: "person",
      rows: [orgOnlyRow("7", "Fresh Co")],
    });
    const r = await commitRow(db, actor, rowIds[0] as string, "person", "skip", signal);
    expect(r.ok && r.value.status).toBe("imported");
    const [fresh] = await db.select().from(organizations).where(eq(organizations.name, "Fresh Co"));
    const [m] = await db.select().from(importExternalIds);
    expect(m?.localId).toBe(fresh?.id);
    expect(m?.batchId).toBe(batchId);
  });
});
