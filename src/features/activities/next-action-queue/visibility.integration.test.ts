import { eq } from "drizzle-orm";
import { expect, test } from "vitest";
import type { PermissionFlagKey } from "@/constants/permissionFlags";
import {
  activityParticipants,
  deals,
  leads,
  organizations,
  persons,
  visibilityGroups,
} from "@/db/schema";
import { seedPipelineWithStages } from "@/db/testing/factories";
import { can } from "@/features/permissions/can";
import { resolveActivityVisibility } from "../visibility";
import {
  actor,
  addActivity,
  addDeal,
  NOW,
  page,
  rowIds,
  signal,
  withQueueDb,
} from "./queue.test-helpers";
import { readNextActionQueue } from "./readNextActionQueue";

test("counts and pages use authorized rows before pagination, including an empty later page", async () => {
  await withQueueDb(async (f) => {
    const hidden = await addDeal(f, {
      title: "Private opportunity",
      ownerId: f.colleague.id,
      visibilityLevel: "owner",
    });
    const hiddenIds: string[] = [];
    for (let index = 0; index < 6; index++) {
      const row = await addActivity(f, {
        dealId: hidden.id,
        subject: `Private activity ${index}`,
        dueAt: new Date("2020-01-01T00:00:00Z"),
      });
      hiddenIds.push(row.id);
    }
    const expected: string[] = [];
    for (let index = 0; index < 3; index++)
      expected.push((await addActivity(f, { subject: `Permitted ${index}` })).id);
    expected.push((await addDeal(f, { title: "No next step" })).id);
    const seen: string[] = [];
    let previousRead = "";
    for (let offset = 0; offset < 4; offset++) {
      const result = await page(f, { offset, limit: 1 });
      expect(result.total).toBe(4);
      expect(result.counts).toEqual({ overdue: 3, missingNextStep: 1 });
      expect(result.rows).toHaveLength(1);
      expect(result.asOf).toBe(NOW.toISOString());
      expect(result.readId).not.toBe(previousRead);
      previousRead = result.readId;
      seen.push(...rowIds(result));
      expect(hiddenIds.some((id) => JSON.stringify(result).includes(id))).toBe(false);
      expect(JSON.stringify(result)).not.toContain("Private");
    }
    expect(seen.sort()).toEqual(expected.sort());
    const empty = await page(f, { offset: 99, limit: 1 });
    expect(empty.rows).toEqual([]);
    expect(empty.total).toBe(4);
    expect(empty.counts).toEqual({ overdue: 3, missingNextStep: 1 });
    const manager = actor(f, {
      flags: new Set<PermissionFlagKey>(["team.viewMembers"]),
      managedUserIds: new Set([f.colleague.id]),
    });
    expect((await page(f, {}, manager)).total).toBe(10);
    await f.h.db
      .update(deals)
      .set({ visibleToUserIds: [f.viewer.id] })
      .where(eq(deals.id, hidden.id));
    expect((await page(f)).total).toBe(10);
  });
});

test("deleted and archived active-work parents stay out even for administrators", async () => {
  await withQueueDb(async (f) => {
    const archived = await seedPipelineWithStages(f.h.db, ["Archived"], { isArchived: true });
    const stage = archived.stages[0];
    if (stage === undefined) throw new Error("Archived stage missing");
    const pipelineDeal = await addDeal(f, { pipelineId: archived.pipeline.id, stageId: stage.id });
    const deletedDeal = await addDeal(f, { deletedAt: NOW });
    const archivedDeal = await addDeal(f, { archivedAt: NOW });
    for (const deal of [pipelineDeal, deletedDeal, archivedDeal])
      await addActivity(f, { dealId: deal.id });
    const [person] = await f.h.db
      .insert(persons)
      .values({
        name: "Deleted person",
        ownerId: f.viewer.id,
        visibilityLevel: "all",
        deletedAt: NOW,
      })
      .returning();
    if (person === undefined) throw new Error("Person missing");
    await addActivity(f, { personId: person.id });
    const won = await addDeal(f, { status: "won" });
    const lost = await addDeal(f, { status: "lost" });
    const wonActivity = await addActivity(f, { dealId: won.id });
    const lostActivity = await addActivity(f, { dealId: lost.id });
    const open = await addDeal(f);
    for (const viewer of [actor(f), actor(f, { type: "admin" })]) {
      const result = await page(f, {}, viewer);
      expect(rowIds(result)).toEqual([wonActivity.id, lostActivity.id, open.id].sort());
      expect(result.counts).toEqual({ overdue: 2, missingNextStep: 1 });
    }
  });
});

test("Mine only narrows assignments and owners; inactive and restricted actors gain no rows", async () => {
  await withQueueDb(async (f) => {
    const mine = await addDeal(f);
    const other = await addDeal(f, { ownerId: f.colleague.id });
    const ownActivity = await addActivity(f);
    const otherActivity = await addActivity(f, {
      dealId: other.id,
      assigneeId: f.colleague.id,
      ownerId: f.colleague.id,
    });
    const [group] = await f.h.db
      .insert(visibilityGroups)
      .values({ name: "Restricted" })
      .returning();
    if (group === undefined) throw new Error("Group missing");
    const restricted = await seedPipelineWithStages(f.h.db, ["Restricted"], {
      visibilityGroupId: group.id,
    });
    const stage = restricted.stages[0];
    if (stage === undefined) throw new Error("Restricted stage missing");
    const hiddenDeal = await addDeal(f, { pipelineId: restricted.pipeline.id, stageId: stage.id });
    const hiddenActivity = await addActivity(f, { dealId: hiddenDeal.id });
    expect(rowIds(await page(f, { scope: "mine" }))).toEqual([mine.id, ownActivity.id].sort());
    expect(rowIds(await page(f))).toEqual([mine.id, ownActivity.id, otherActivity.id].sort());
    expect(rowIds(await page(f, {}, actor(f, { type: "admin" })))).toContain(hiddenActivity.id);
    expect(rowIds(await page(f, {}, actor(f, { groupIds: new Set([group.id]) })))).toContain(
      hiddenActivity.id,
    );
    for (const deniedActor of [actor(f, { type: "admin", isActive: false }), null]) {
      const denied = await readNextActionQueue(
        f.h.db,
        deniedActor,
        { scope: "all-permitted", limit: 100, offset: 0 },
        signal(),
        NOW,
      );
      expect(denied).toMatchObject({ ok: false, error: { id: "E_PERM_001" } });
      expect(denied).not.toHaveProperty("value");
    }
  });
});

test("permitted rows redact private secondary person, organization and lead IDs as well as labels", async () => {
  await withQueueDb(async (f) => {
    const [person] = await f.h.db
      .insert(persons)
      .values({ name: "Secret person", ownerId: f.colleague.id, visibilityLevel: "owner" })
      .returning();
    const [org] = await f.h.db
      .insert(organizations)
      .values({ name: "Secret organization", ownerId: f.colleague.id, visibilityLevel: "owner" })
      .returning();
    const [lead] = await f.h.db
      .insert(leads)
      .values({ title: "Secret lead", ownerId: f.colleague.id, visibilityLevel: "owner" })
      .returning();
    if (person === undefined || org === undefined || lead === undefined)
      throw new Error("Private fixtures missing");
    const linked = await addDeal(f, {
      ownerId: f.colleague.id,
      personId: person.id,
      orgId: org.id,
    });
    const activity = await addActivity(f, {
      dealId: linked.id,
      personId: person.id,
      orgId: org.id,
    });
    const missing = await addDeal(f, { personId: person.id, orgId: org.id });
    const leadOnly = await addActivity(f, { leadId: lead.id });
    const result = await page(f);
    expect(rowIds(result)).toEqual([activity.id, missing.id, leadOnly.id].sort());
    expect(result.rows.every((row) => row.person === null && row.organization === null)).toBe(true);
    const standalone = result.rows.find((row) => row.id === leadOnly.id);
    expect(standalone?.kind).toBe("activity");
    if (standalone?.kind === "activity") expect(standalone.lead).toBeNull();
    for (const hidden of [person.id, org.id, lead.id, person.name, org.name, lead.title])
      expect(JSON.stringify(result)).not.toContain(hidden);
  });
});

test("action hints mirror canonical capabilities only after visibility, without granting creator ownership", async () => {
  await withQueueDb(async (f) => {
    const participant = await addActivity(f, { assigneeId: f.colleague.id });
    await f.h.db
      .insert(activityParticipants)
      .values({ activityId: participant.id, userId: f.viewer.id });
    const linked = await addDeal(f, { ownerId: f.colleague.id });
    const assigned = await addActivity(f, { dealId: linked.id });
    const missing = await addDeal(f, { ownerId: f.colleague.id });
    const viewer = actor(f, { flags: new Set<PermissionFlagKey>() });
    const result = await page(f, {}, viewer);
    for (const activity of [participant, assigned]) {
      const vis = await resolveActivityVisibility(f.h.db, activity, signal());
      if (vis === null) throw new Error("Visible fixture missing");
      const row = result.rows.find((item) => item.id === activity.id);
      expect(row?.kind).toBe("activity");
      if (row?.kind !== "activity") continue;
      expect(row.canEdit).toBe(can(viewer, "activity.edit", vis));
      expect(row.canComplete).toBe(can(viewer, "activity.complete", vis));
    }
    const noCreate = result.rows.find((row) => row.id === missing.id);
    if (noCreate?.kind !== "deal") throw new Error("Missing-deal fixture absent");
    expect(noCreate.canSchedule).toBe(false);
    const allowed = (await page(f)).rows.find((row) => row.id === missing.id);
    if (allowed?.kind !== "deal") throw new Error("Missing-deal fixture absent");
    expect(allowed.canSchedule).toBe(true);
  });
});
