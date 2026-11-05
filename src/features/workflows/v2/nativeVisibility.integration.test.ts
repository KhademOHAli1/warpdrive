import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { activities, activityTypes, organizations, persons, visibilityGroups } from "@/db/schema";
import { withTestDb } from "@/db/testing";
import { seedPipelineWithStages, seedUser } from "@/db/testing/factories";
import type { BlockOutput } from "@/features/blocks/contracts";
import type { PermSetUser } from "@/features/permissions/effective";
import { projectNativeEvent } from "./nativeEvents";
import { nativeFieldCatalog } from "./nativeFields";
import { findNativeRecords } from "./nativeRecords";

const signal = () => AbortSignal.timeout(10_000);
const actor = (id: string, admin = false): PermSetUser => ({
  id,
  type: admin ? "admin" : "regular",
  isActive: true,
  groupIds: new Set(),
  flags: new Set(),
});

it("returns real pipeline and stage choices without restricted pipeline names", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const [group] = await db.insert(visibilityGroups).values({ name: "Restricted" }).returning();
    if (group === undefined) throw new Error("group fixture missing");
    const visible = await seedPipelineWithStages(db, ["Visible stage"]);
    const restricted = await seedPipelineWithStages(db, ["Secret stage"], {
      visibilityGroupId: group.id,
    });
    const fields = await nativeFieldCatalog(db, actor(user.id), "deal", signal(), {
      includeChoices: true,
    });
    const pipelines = fields.find((field) => field.key === "pipelineId")?.options;
    const stages = fields.find((field) => field.key === "stageId")?.options;
    expect(pipelines?.map((option) => option.id)).toContain(visible.pipeline.id);
    expect(pipelines?.map((option) => option.id)).not.toContain(restricted.pipeline.id);
    expect(stages?.map((option) => option.id)).toContain(visible.stages[0]?.id);
    expect(stages?.map((option) => option.id)).not.toContain(restricted.stages[0]?.id);
  });
});

it("redacts hidden links and rejects hidden and missing reference probes identically", async () => {
  await withTestDb(async (db) => {
    const owner = await seedUser(db);
    const viewer = await seedUser(db);
    const [hidden] = await db
      .insert(organizations)
      .values({ name: "Hidden", ownerId: owner.id, visibilityLevel: "owner" })
      .returning();
    if (hidden === undefined) throw new Error("organization fixture missing");
    const [person] = await db
      .insert(persons)
      .values({
        name: "Visible person",
        ownerId: owner.id,
        visibilityLevel: "all",
        orgId: hidden.id,
      })
      .returning();
    if (person === undefined) throw new Error("person fixture missing");
    const who = actor(viewer.id);
    const records = await findNativeRecords(
      db,
      who,
      {
        objectName: "person",
        filters: [{ field: "createdAt", operator: "eq", value: person.createdAt.toISOString() }],
      },
      signal(),
    );
    expect(records).toMatchObject([{ id: person.id, orgId: null }]);
    for (const id of [hidden.id, randomUUID()]) {
      await expect(
        findNativeRecords(
          db,
          who,
          { objectName: "person", filters: [{ field: "orgId", operator: "eq", value: id }] },
          signal(),
        ),
      ).rejects.toThrow("workflow_native_filter_reference_unavailable");
    }
  });
});

it("checks the current dominant parent before projecting a soft-deleted activity snapshot", async () => {
  await withTestDb(async (db) => {
    const owner = await seedUser(db, { isAdmin: true });
    const viewer = await seedUser(db);
    const [person] = await db
      .insert(persons)
      .values({ name: "Private parent", ownerId: owner.id, visibilityLevel: "owner" })
      .returning();
    const [type] = await db.select().from(activityTypes).where(eq(activityTypes.key, "meeting"));
    if (person === undefined || type === undefined) throw new Error("activity fixture missing");
    const [row] = await db
      .insert(activities)
      .values({
        subject: "Event-time subject",
        typeId: type.id,
        ownerId: owner.id,
        assigneeId: viewer.id,
        personId: person.id,
      })
      .returning();
    if (row === undefined) throw new Error("activity insert missing");
    const snapshots = await db.execute<{ snapshot: BlockOutput }>(
      sql`SELECT to_jsonb(a) AS snapshot FROM activities a WHERE id=${row.id}::uuid`,
    );
    const before = snapshots.rows[0]?.snapshot;
    if (before === undefined) throw new Error("snapshot missing");
    await db
      .update(activities)
      .set({ deletedAt: new Date(), subject: "Later subject" })
      .where(eq(activities.id, row.id));
    const event = {
      entity: "activity",
      id: row.id,
      eventName: "activity.deleted",
      before: { ...before, privateDebug: "not projected" },
      after: null,
    };
    expect(await projectNativeEvent(db, actor(viewer.id), event, signal())).toBeNull();
    const visible = await projectNativeEvent(db, actor(owner.id, true), event, signal());
    expect(visible).toMatchObject({ record: { subject: "Event-time subject" } });
    expect(JSON.stringify(visible)).not.toContain("privateDebug");
    await db.update(persons).set({ deletedAt: new Date() }).where(eq(persons.id, person.id));
    expect(await projectNativeEvent(db, actor(owner.id, true), event, signal())).toBeNull();
  });
});
