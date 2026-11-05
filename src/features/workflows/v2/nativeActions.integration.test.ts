import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import type { Db } from "@/db/client";
import { activityTypes, organizations, persons } from "@/db/schema";
import { withTestDb } from "@/db/testing";
import { seedPipelineWithStages, seedUser } from "@/db/testing/factories";
import type { BlockOutput, WorkflowV2Node } from "@/features/blocks/contracts";
import { createDef } from "@/features/custom-fields/defsRepo";
import type { PermSetUser } from "@/features/permissions/effective";
import { executeNativeAction } from "./nativeActions";
import { type NativeObjectName, nativeFieldCatalog } from "./nativeFields";
import { findNativeRecords } from "./nativeRecords";
import { upsertNativeRecord } from "./nativeUpsert";

const signal = () => AbortSignal.timeout(10_000);
function actor(id: string, admin = true): PermSetUser {
  return {
    id,
    type: admin ? "admin" : "regular",
    isActive: true,
    flags: new Set(),
    groupIds: new Set(),
  };
}
async function action(db: Db, who: PermSetUser, type: WorkflowV2Node["type"], config: BlockOutput) {
  return db.transaction((tx) =>
    executeNativeAction(tx, {
      actor: who,
      node: { id: "record", type, name: type, version: 1, config },
      resolvedConfig: config,
      effectKey: randomUUID(),
      signal: signal(),
      nextPickIndex: () => Promise.resolve(0),
    }),
  );
}

it("creates, updates, finds and soft-deletes all five native objects through app services", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db, { isAdmin: true });
    const who = actor(user.id);
    const pipeline = await seedPipelineWithStages(db, ["Qualified"]);
    const [type] = await db.select().from(activityTypes).where(eq(activityTypes.key, "call"));
    if (type === undefined || pipeline.stages[0] === undefined) throw new Error("fixture missing");
    const fixtures: [NativeObjectName, BlockOutput, string][] = [
      [
        "deal",
        { title: "Native deal", pipelineId: pipeline.pipeline.id, stageId: pipeline.stages[0].id },
        "title",
      ],
      ["lead", { title: "Native lead" }, "title"],
      ["person", { name: "Native person" }, "name"],
      ["organization", { name: "Native organization" }, "name"],
      ["activity", { subject: "Native activity", typeId: type.id }, "subject"],
    ];
    for (const [objectName, fields, label] of fixtures) {
      const created = await action(db, who, "CREATE_RECORD", { objectName, fields });
      expect(created.ok).toBe(true);
      if (!created.ok || typeof created.value.recordId !== "string")
        throw new Error("native create failed");
      const id = created.value.recordId;
      expect(
        (
          await action(db, who, "UPDATE_RECORD", {
            objectName,
            recordId: id,
            fields: { [label]: "Updated" },
          })
        ).ok,
      ).toBe(true);
      const found = await findNativeRecords(
        db,
        who,
        { objectName, filters: [{ field: label, operator: "eq", value: "Updated" }] },
        signal(),
      );
      expect(found.map((record) => record.id)).toContain(id);
      expect((await action(db, who, "DELETE_RECORD", { objectName, recordId: id })).ok).toBe(true);
      expect(
        await findNativeRecords(
          db,
          who,
          { objectName, filters: [{ field: "id", operator: "eq", value: id }] },
          signal(),
        ),
      ).toEqual([]);
    }
  });
});

it("does not expose hidden records through find, pick or upsert and honors withheld create permission", async () => {
  await withTestDb(async (db) => {
    const owner = await seedUser(db);
    const stranger = await seedUser(db);
    const [hidden] = await db
      .insert(persons)
      .values({
        name: "Hidden",
        ownerId: owner.id,
        visibilityLevel: "owner",
        primaryEmail: "hidden@example.com",
      })
      .returning();
    if (hidden === undefined) throw new Error("fixture missing");
    const who = actor(stranger.id, false);
    expect(await findNativeRecords(db, who, { objectName: "person" }, signal())).toEqual([]);
    const picked = await action(db, who, "PICK_RECORD", {
      objectName: "person",
      recordIds: [hidden.id],
      selectionMode: "RANDOM",
    });
    expect(picked).toMatchObject({
      ok: true,
      value: { record: null, recordId: null, found: false },
    });
    const upserted = await db.transaction((tx) =>
      upsertNativeRecord(
        tx,
        who,
        {
          objectName: "person",
          matchField: "primaryEmail",
          matchValue: "hidden@example.com",
          fields: { name: "Changed" },
        },
        signal(),
      ),
    );
    expect(upserted).toEqual({ ok: false, error: "workflow_native_identity_unresolvable" });
    expect(
      (await action(db, who, "CREATE_RECORD", { objectName: "person", fields: { name: "Denied" } }))
        .ok,
    ).toBe(false);
  });
});

it("balances candidate organizations by related records visible to the running actor", async () => {
  await withTestDb(async (db) => {
    const owner = await seedUser(db, { isAdmin: true });
    const member = await seedUser(db);
    const [a, b] = await db
      .insert(organizations)
      .values([
        { name: "Organization A", ownerId: owner.id, visibilityLevel: "all" },
        { name: "Organization B", ownerId: owner.id, visibilityLevel: "all" },
      ])
      .returning();
    if (a === undefined || b === undefined) throw new Error("fixture missing");
    await db.insert(persons).values([
      { name: "Visible to member", orgId: a.id, ownerId: owner.id, visibilityLevel: "all" },
      { name: "Private contact 1", orgId: b.id, ownerId: owner.id, visibilityLevel: "owner" },
      { name: "Private contact 2", orgId: b.id, ownerId: owner.id, visibilityLevel: "owner" },
    ]);
    const config = {
      objectName: "organization",
      recordIds: [a.id, b.id],
      selectionMode: "LOAD_BALANCED",
      loadRelation: { objectName: "person", field: "orgId" },
    };
    expect(await action(db, actor(member.id, false), "PICK_RECORD", config)).toMatchObject({
      ok: true,
      value: { recordId: b.id },
    });
    expect(await action(db, actor(owner.id), "PICK_RECORD", config)).toMatchObject({
      ok: true,
      value: { recordId: a.id },
    });
  });
});

it("serializes cooperating upserts, rejects ambiguous identities, and exposes only active custom fields", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db, { isAdmin: true });
    const who = actor(user.id);
    const def = await createDef(
      db,
      { targetEntity: "person", type: "text", name: "External ID" },
      signal(),
    );
    if (!def.ok) throw def.error;
    const config = {
      objectName: "person",
      matchField: "customFields.external_id",
      matchValue: "stable-42",
      fields: { name: "One person" },
    };
    const results = await Promise.all(
      [1, 2].map(() => db.transaction((tx) => upsertNativeRecord(tx, who, config, signal()))),
    );
    expect(results.every((result) => result.ok)).toBe(true);
    const rows = await findNativeRecords(
      db,
      who,
      {
        objectName: "person",
        filters: [{ field: "customFields.external_id", operator: "eq", value: "stable-42" }],
      },
      signal(),
    );
    expect(rows).toHaveLength(1);
    await db.insert(persons).values({
      name: "Duplicate",
      ownerId: user.id,
      visibilityLevel: "all",
      customFields: { external_id: "stable-42" },
    });
    expect(await db.transaction((tx) => upsertNativeRecord(tx, who, config, signal()))).toEqual({
      ok: false,
      error: "workflow_native_identity_unresolvable",
    });
    expect(
      (await nativeFieldCatalog(db, who, "person", signal())).find(
        (field) => field.key === "customFields.external_id",
      ),
    ).toMatchObject({ upsertIdentity: true, createable: true });
  });
});
