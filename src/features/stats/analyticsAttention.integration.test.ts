import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { seedPipelineWithStages } from "@/db/testing/factories";
import {
  actor,
  addActivity,
  addDeal,
  NOW,
  page,
  type QueueFixture,
  setZone,
  signal,
  withQueueDb,
} from "@/features/activities/next-action-queue/queue.test-helpers";
import {
  type AnalyticsAttentionRequest,
  MAX_ANALYTICS_ATTENTION_MATCHES,
  readAnalyticsAttention,
} from "./analyticsAttention";

function read(f: QueueFixture, patch: Partial<AnalyticsAttentionRequest> = {}, asOf = NOW) {
  return readAnalyticsAttention(
    f.h.db,
    actor(f),
    {
      currency: "EUR",
      pipelineId: f.pipe.pipeline.id,
      ownerScope: { kind: "me" },
      ...patch,
    },
    signal(),
    asOf,
  );
}

test("scopes the shared overdue and missing-step rules to authorized deal currency, pipeline and owner", async () => {
  await withQueueDb(async (f) => {
    const overdueDeal = await addDeal(f, { currency: "EUR" });
    const overdue = await addActivity(f, {
      dealId: overdueDeal.id,
      assigneeId: f.colleague.id,
      ownerId: f.colleague.id,
    });
    const missing = await addDeal(f, { currency: "EUR" });
    const undated = await addDeal(f, { currency: "EUR", nextActivityAt: null });
    await addActivity(f, { dealId: undated.id, dueAt: null, assigneeId: f.colleague.id });
    const otherCurrency = await addDeal(f, { currency: "USD" });
    const otherOwner = await addDeal(f, { currency: "EUR", ownerId: f.colleague.id });
    await addActivity(f, { dealId: otherOwner.id, assigneeId: f.viewer.id });
    const hidden = await addDeal(f, {
      currency: "EUR",
      ownerId: f.colleague.id,
      visibilityLevel: "owner",
    });
    await addActivity(f, { dealId: hidden.id, assigneeId: f.viewer.id });
    const otherPipeline = await seedPipelineWithStages(f.h.db, ["Other"]);
    const [otherStage] = otherPipeline.stages;
    if (otherStage === undefined) throw new Error("Expected fixture stage");
    await addDeal(f, {
      currency: "EUR",
      pipelineId: otherPipeline.pipeline.id,
      stageId: otherStage.id,
    });
    const parentless = await addActivity(f);

    expect(await read(f, { limit: 1 })).toMatchObject({
      state: "available",
      definition: "current-deal-next-action-queue-v1",
      total: 2,
      counts: { overdueActivities: 1, dealsWithoutNextStep: 1 },
      page: {
        offset: 0,
        limit: 1,
        complete: false,
        hasMore: true,
        rows: [
          {
            rule: "overdue",
            activityId: overdue.id,
            dealId: overdueDeal.id,
            evidence: { kind: "due-instant", at: "2026-10-30T09:00:00.000000Z" },
          },
        ],
      },
    });
    const second = await read(f, { limit: 1, offset: 1 });
    expect(second).toMatchObject({
      state: "available",
      total: 2,
      page: {
        offset: 1,
        complete: false,
        hasMore: false,
        rows: [
          {
            rule: "missing-next-step",
            dealId: missing.id,
            evidence: { kind: "no-open-linked-activity" },
          },
        ],
      },
    });
    const full = await read(f);
    if (full.state !== "available") throw new Error("Expected scoped analytics attention");
    expect(full.page.complete).toBe(true);
    expect(full.page.rows).toHaveLength(2);
    expect(JSON.stringify(full)).not.toContain(hidden.id);
    expect(JSON.stringify(full)).not.toContain(otherCurrency.id);
    expect(JSON.stringify(full)).not.toContain(parentless.id);
    const permission = randomUUID();
    await f.h.pool.query(
      "INSERT INTO permission_sets(id,name,flags) VALUES($1,$2,'{\"stats.viewOthers\":true}'::jsonb)",
      [permission, `attention-fixture-${permission}`],
    );
    await f.h.pool.query("UPDATE users SET permission_set_id=$1 WHERE id=$2", [
      permission,
      f.viewer.id,
    ]);
    const requestedBroad = actor(f, { flags: new Set(["stats.viewOthers"]) });
    const scope = {
      currency: "EUR",
      pipelineId: f.pipe.pipeline.id,
      ownerScope: { kind: "all" },
    } as const;
    const broad = await readAnalyticsAttention(f.h.db, requestedBroad, scope, signal(), NOW);
    expect(broad).toMatchObject({
      state: "available",
      total: 3,
      counts: { overdueActivities: 2, dealsWithoutNextStep: 1 },
    });
    expect(JSON.stringify(broad)).not.toContain(hidden.id);
    await f.h.pool.query("UPDATE users SET permission_set_id=NULL WHERE id=$1", [f.viewer.id]);
    expect(await readAnalyticsAttention(f.h.db, requestedBroad, scope, signal(), NOW)).toEqual({
      state: "permission",
    });
    // The opt-in projection and scope do not change canonical queue behavior.
    expect((await page(f)).rows.map(({ id }) => id)).toContain(parentless.id);
  });
});

test("retains exact timed evidence and the canonical final-day distinction", async () => {
  await withQueueDb(async (f) => {
    await setZone(f, "Europe/Berlin");
    const timed = await addDeal(f, { currency: "EUR", status: "won" });
    const earlier = await addActivity(f, { dealId: timed.id });
    await f.h.pool.query(
      "UPDATE activities SET due_at=$1::timestamptz - interval '1 microsecond' WHERE id=$2",
      [NOW.toISOString(), earlier.id],
    );
    await addActivity(f, { dealId: timed.id, dueAt: NOW });
    const allDay = await addDeal(f, { currency: "EUR" });
    const pastCivil = await addActivity(f, {
      dealId: allDay.id,
      allDay: true,
      dueAt: new Date("2026-10-29T00:00:00Z"),
      endAt: new Date("2026-10-30T00:00:00Z"),
      dueDate: "2026-10-29",
      endDate: "2026-10-30",
    });
    await addActivity(f, {
      dealId: allDay.id,
      allDay: true,
      dueAt: new Date("2026-10-29T00:00:00Z"),
      endAt: new Date("2026-10-31T00:00:00Z"),
      dueDate: "2026-10-29",
      endDate: "2026-10-31",
    });
    const result = await read(f);
    if (result.state !== "available") throw new Error("Expected dated attention");
    expect(result.observedAt).toBe("2026-10-31T12:00:00.000000Z");
    expect(result.timeZone).toBe("Europe/Berlin");
    expect(result.counts).toEqual({ overdueActivities: 2, dealsWithoutNextStep: 0 });
    expect(result.page.rows).toEqual(
      expect.arrayContaining([
        {
          rule: "overdue",
          dealId: timed.id,
          activityId: earlier.id,
          evidence: { kind: "due-instant", at: "2026-10-31T11:59:59.999999Z" },
        },
        {
          rule: "overdue",
          dealId: allDay.id,
          activityId: pastCivil.id,
          evidence: { kind: "final-civil-day", date: "2026-10-30", basis: "recorded-civil" },
        },
      ]),
    );
    expect(result.page.rows).toHaveLength(2);
  });
});

test("uses the same account midnight for recorded and legacy final-day evidence", async () => {
  await withQueueDb(async (f) => {
    await setZone(f, "Europe/Berlin");
    const deal = await addDeal(f, { currency: "EUR" });
    const recorded = await addActivity(f, {
      dealId: deal.id,
      allDay: true,
      dueDate: "2026-10-30",
      endDate: "2026-10-31",
      dueAt: new Date("2026-10-30T00:00:00Z"),
      // Deliberate disagreement. The recorded civil end, rather than this anchor, owns the day.
      endAt: new Date("2026-11-01T00:00:00Z"),
    });
    const legacy = await addActivity(f, {
      dealId: deal.id,
      allDay: true,
      dueAt: new Date("2026-10-30T00:00:00Z"),
      endAt: new Date("2026-10-31T22:30:00Z"),
    });
    const nextDay = await addActivity(f, {
      dealId: deal.id,
      allDay: true,
      dueAt: new Date("2026-10-30T00:00:00Z"),
      // Still October 31 in UTC, already November 1 in the account zone.
      endAt: new Date("2026-10-31T23:30:00Z"),
    });

    const midnight = new Date("2026-10-31T23:00:00Z");
    const justBefore = new Date(midnight.getTime() - 1);
    expect(await read(f, {}, justBefore)).toMatchObject({
      state: "available",
      total: 0,
      page: { rows: [] },
    });
    const report = await read(f, {}, midnight);
    if (report.state !== "available") throw new Error("Expected native account-day attention");
    expect(report.observedAt).toBe("2026-10-31T23:00:00.000000Z");
    expect(report.timeZone).toBe("Europe/Berlin");
    expect(report.counts).toEqual({ overdueActivities: 2, dealsWithoutNextStep: 0 });
    expect(report.page.rows).toEqual(
      expect.arrayContaining([
        {
          rule: "overdue",
          dealId: deal.id,
          activityId: recorded.id,
          evidence: { kind: "final-civil-day", date: "2026-10-31", basis: "recorded-civil" },
        },
        {
          rule: "overdue",
          dealId: deal.id,
          activityId: legacy.id,
          evidence: { kind: "final-civil-day", date: "2026-10-31", basis: "legacy-zoned" },
        },
      ]),
    );
    expect(report.page.rows).toHaveLength(2);
    const regular = await page(f, {}, undefined, midnight);
    expect(regular.timeZone).toBe(report.timeZone);
    expect(regular.rows.map(({ id }) => id).sort()).toEqual([recorded.id, legacy.id].sort());

    const tomorrow = await read(f, {}, new Date("2026-11-01T23:00:00Z"));
    expect(tomorrow).toMatchObject({
      state: "available",
      total: 3,
      page: {
        rows: expect.arrayContaining([
          {
            rule: "overdue",
            dealId: deal.id,
            activityId: nextDay.id,
            evidence: { kind: "final-civil-day", date: "2026-11-01", basis: "legacy-zoned" },
          },
        ]),
      },
    });
  });
});

test("distinguishes no matches from denied scope and an unavailable queue source", async () => {
  await withQueueDb(async (f) => {
    const native = await readAnalyticsAttention(
      f.h.db,
      actor(f),
      { currency: "EUR", pipelineId: f.pipe.pipeline.id, ownerScope: { kind: "me" } },
      signal(),
    );
    expect(native).toMatchObject({
      state: "available",
      observedAt: expect.stringMatching(/\.\d{6}Z$/u),
      total: 0,
      counts: { overdueActivities: 0, dealsWithoutNextStep: 0 },
      page: { complete: true, hasMore: false, rows: [] },
    });
    expect(await read(f, { pipelineId: randomUUID() })).toEqual({
      state: "unavailable",
      reason: "scope-unavailable",
    });
    expect(await read(f, { ownerScope: { kind: "all" } })).toEqual({ state: "permission" });
    await f.h.pool.query("ALTER TABLE activities RENAME TO fixture_attention_offline");
    expect(await read(f)).toEqual({ state: "unavailable", reason: "source-unavailable" });
  });
});

test("withholds counts and anchors when the authorized match cap is exceeded", async () => {
  await withQueueDb(async (f) => {
    await f.h.pool.query(
      `INSERT INTO deals(title,pipeline_id,stage_id,owner_id,visibility_level,currency)
      SELECT 'Attention cap ' || n,$1::uuid,$2::uuid,$3::uuid,'owner','EUR'
      FROM pg_catalog.generate_series(1,$4::integer) n`,
      [f.pipe.pipeline.id, f.stage.id, f.viewer.id, MAX_ANALYTICS_ATTENTION_MATCHES + 1],
    );
    expect(await read(f)).toEqual({ state: "unavailable", reason: "match-limit" });
  });
});
