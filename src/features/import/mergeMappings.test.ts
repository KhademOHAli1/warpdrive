import { and, eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { importExternalIds } from "@/db/schema";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
import { mergeOrgs, mergePersons } from "@/features/contacts/merge";
import { adminActor } from "@/features/contacts/mergeTestActors";
import { mergeDeals } from "@/features/deal-workspace/mergeDeals";
import {
  mapExternal,
  runActivity,
  seedDeal,
  seedOrg,
  seedPerson,
} from "./activityImport.testHelpers";
import { writeMapping } from "./externalIds";
import { lockImportMutation } from "./importLock";
import { adminActorFor, seedBatchWithRows } from "./pipedriveImport.testHelpers";

const signal = new AbortController().signal;

const localIdOf = async (
  db: Parameters<Parameters<typeof withTestDb>[0]>[0],
  entity: string,
  externalId: string,
) => {
  const [row] = await db
    .select({ localId: importExternalIds.localId })
    .from(importExternalIds)
    .where(and(eq(importExternalIds.entity, entity), eq(importExternalIds.externalId, externalId)));
  return row?.localId;
};

it("repoints a person mapping to the survivor and links a later activity import to it", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const survivor = await seedPerson(db, user.id, "Jane Roe");
    const loser = await seedPerson(db, user.id, "J. Roe");
    await mapExternal(db, user.id, "person", "12", loser.id);
    const r = await mergePersons(
      db,
      adminActor(user.id),
      { survivorId: survivor.id, mergedId: loser.id, fieldChoices: {} },
      signal,
    );
    expect(r.ok).toBe(true);
    expect(await localIdOf(db, "person", "12")).toBe(survivor.id);
    const imported = await runActivity(db, adminActorFor(user.id), { personPipedriveId: "12" });
    expect(imported.outcome.ok && imported.outcome.value.status).toBe("imported");
    expect(imported.errors).toEqual([]);
  });
});

it("repoints an organization mapping to the survivor", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const survivor = await seedOrg(db, user.id, "Acme");
    const loser = await seedOrg(db, user.id, "Acme Inc");
    await mapExternal(db, user.id, "organization", "13", loser.id);
    const r = await mergeOrgs(
      db,
      adminActor(user.id),
      { survivorId: survivor.id, mergedId: loser.id, fieldChoices: { name: "Acme" } },
      signal,
    );
    expect(r.ok).toBe(true);
    expect(await localIdOf(db, "organization", "13")).toBe(survivor.id);
  });
});

it("repoints a deal mapping to the survivor and leaves other entities alone", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const survivor = await seedDeal(db, user.id, "Target");
    const loser = await seedDeal(db, user.id, "Source");
    await mapExternal(db, user.id, "deal", "11", loser.id);
    await mapExternal(db, user.id, "person", "11", loser.id);
    const r = await mergeDeals(
      db,
      { ...adminActor(user.id), flags: new Set(["deal.edit_any"]) },
      {
        targetDealId: survivor.id,
        sourceDealId: loser.id,
        expectedTargetUpdatedAt: survivor.updatedAt.toISOString(),
        expectedSourceUpdatedAt: loser.updatedAt.toISOString(),
      },
      signal,
    );
    expect(r.ok).toBe(true);
    expect(await localIdOf(db, "deal", "11")).toBe(survivor.id);
    expect(await localIdOf(db, "person", "11")).toBe(loser.id);
  });
});

it("leaves no mapping on the soft-deleted loser when an import holds the lock during the merge", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const survivor = await seedPerson(db, user.id, "Survivor");
    const loser = await seedPerson(db, user.id, "Loser");
    const { batchId } = await seedBatchWithRows(db, user.id, {
      source: "pipedrive",
      target: "person",
      rows: [],
    });
    let settled = false;
    let merge: Promise<unknown> = Promise.resolve();
    await db.transaction(async (tx) => {
      await lockImportMutation(tx, signal);
      merge = mergePersons(
        db,
        adminActor(user.id),
        { survivorId: survivor.id, mergedId: loser.id, fieldChoices: {} },
        signal,
      ).then(() => {
        settled = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(settled).toBe(false);
      await writeMapping(
        tx,
        { source: "pipedrive", entity: "person", externalId: "77", localId: loser.id, batchId },
        signal,
      );
    });
    await merge;
    expect(settled).toBe(true);
    expect(await localIdOf(db, "person", "77")).toBe(survivor.id);
  });
});
