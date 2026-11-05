// @vitest-environment node
import { eq, sql } from "drizzle-orm";
import { describe, expect, test } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import * as schema from "@/db/schema";
import { withTestDb } from "@/db/testing";
import { seedPipelineWithStages, seedUser } from "@/db/testing/factories";
import { setPreferences } from "@/features/identity/preferencesRepo";
import type { HydratedActor } from "@/server/hydrateActor";
import { createCaller } from "@/server/trpc/root";
import type { DashboardFilters } from "@/types/stats";
import { dealPerformance } from "./dealPerformance";
import { type DealRecordsCursor, dealRecords } from "./dealRecords";
import type { DealRecordMetric } from "./metricDictionary";
import { reportPeriod } from "./reportPeriod";
import { winRate } from "./winRate";
import { wonDealStats } from "./wonDealStats";

const RANGE = { from: "2026-06-01", to: "2026-06-30" };
const signal = () => AbortSignal.timeout(10_000);

function actorFor(user: typeof schema.users.$inferSelect): HydratedActor {
  return {
    id: user.id,
    type: user.isAdmin ? "admin" : "regular",
    isActive: user.isActive,
    name: user.name,
    email: user.email,
    avatarUrl: null,
    groupIds: new Set(),
    flags: new Set(),
  };
}

async function fixture(db: Db) {
  const user = await seedUser(db);
  const actor = actorFor(user);
  const { pipeline, stages } = await seedPipelineWithStages(db, ["Qualify"]);
  const stage = stages[0];
  if (stage === undefined) throw new AppError(ERROR_IDS.DB_INSERT_FAILED, "Missing test stage");
  const stageId = stage.id;
  const filters: DashboardFilters = {
    ...RANGE,
    currency: "USD",
    pipelineId: pipeline.id,
    owners: { everyone: true },
    timeZone: "UTC",
  };
  async function add(overrides: Partial<typeof schema.deals.$inferInsert> = {}) {
    const [deal] = await db
      .insert(schema.deals)
      .values({
        title: "Report deal",
        pipelineId: pipeline.id,
        stageId,
        ownerId: user.id,
        visibilityLevel: "all",
        currency: "USD",
        value: "10.00",
        status: "won",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        wonTime: new Date("2026-06-15T12:00:00Z"),
        ...overrides,
      })
      .returning();
    if (deal === undefined) throw new AppError(ERROR_IDS.DB_INSERT_FAILED, "Missing test deal");
    return deal;
  }
  function read(metric: DealRecordMetric, limit = 25, cursor?: DealRecordsCursor) {
    return dealRecords(db, actor, filters, { metric, limit, cursor }, signal());
  }
  const caller = createCaller({
    db,
    actor,
    session: { userId: user.id, sessionId: "report-test" },
  });
  return { user, actor, pipeline, stage, filters, add, read, caller };
}

describe("permission-safe report record populations", () => {
  test("reconciles all won pages with count, exact four-place money and non-null sample count", async () => {
    await withTestDb(async (db) => {
      const f = await fixture(db);
      await f.add({ value: "99999999999999.1234" });
      await f.add({ value: "0.0001" });
      await f.add({ value: null });
      const first = await f.read("won", 1);
      const second = await f.read("won", 1, first.nextCursor ?? undefined);
      const third = await f.read("won", 1, second.nextCursor ?? undefined);
      const records = [...first.rows, ...second.rows, ...third.rows];
      expect(new Set(records.map((row) => row.id)).size).toBe(3);
      expect(records.map((row) => row.value)).toEqual(
        expect.arrayContaining(["99999999999999.1234", "0.0001", null]),
      );
      expect(first.totals).toEqual({ count: 3, value: "99999999999999.1235", valueCount: 2 });
      expect(second.totals).toEqual(first.totals);
      expect(third.nextCursor).toBeNull();
      const summary = await dealPerformance(db, f.actor, f.filters, signal());
      expect(summary.won).toEqual({ count: first.totals.count, value: first.totals.value });
    });
  });

  test("reconciles the win-rate denominator to won and lost records only", async () => {
    await withTestDb(async (db) => {
      const f = await fixture(db);
      await f.add();
      await f.add({
        status: "lost",
        value: "5",
        wonTime: null,
        lostTime: new Date("2026-06-20T00:00:00Z"),
      });
      await f.add({ status: "open", wonTime: null });
      await f.add({ wonTime: new Date("2026-07-01T00:00:00Z") });
      const page = await f.read("closed");
      const summary = await dealPerformance(db, f.actor, f.filters, signal());
      expect(page.totals).toEqual({ count: 2, value: "15.00", valueCount: 2 });
      expect(page.rows.map((row) => row.status).sort()).toEqual(["lost", "won"]);
      expect(page.totals.count).toBe(summary.won.count + summary.lost.count);
      expect(winRate(summary.won, summary.lost)).toBe(0.5);
    });
  });

  test("uses valued wins for deal-size samples, retaining recorded zero and excluding null", async () => {
    await withTestDb(async (db) => {
      const f = await fixture(db);
      await f.add({ value: null });
      await f.add({ value: "0" });
      await f.add({ value: "10" });
      const page = await f.read("wonValue");
      expect(page.totals).toEqual({ count: 2, value: "10.00", valueCount: 2 });
      expect(page.rows.map((row) => row.value).sort()).toEqual(["0.00", "10.00"]);
      expect(await wonDealStats(db, f.actor, f.filters, signal())).toMatchObject({
        avgValue: "5.00",
        medianValue: "5.00",
      });
    });
  });

  test("keeps nonnegative won cycles separate from money, lost outcomes and open ages", async () => {
    await withTestDb(async (db) => {
      const f = await fixture(db);
      const close = new Date("2026-06-15T00:00:00Z");
      const zero = await f.add({ createdAt: close, wonTime: close, value: null });
      const ten = await f.add({
        createdAt: new Date("2026-06-05T00:00:00Z"),
        wonTime: close,
        value: null,
      });
      await f.add({ createdAt: new Date("2026-06-16T00:00:00Z"), wonTime: close });
      await f.add({ status: "lost", wonTime: null, lostTime: close });
      await f.add({ status: "open", wonTime: null });
      const page = await f.read("wonCycle");
      expect(page.rows.map((row) => row.id).sort()).toEqual([zero.id, ten.id].sort());
      expect(page.totals).toEqual({ count: 2, value: "0.00", valueCount: 0 });
      expect(await wonDealStats(db, f.actor, f.filters, signal())).toMatchObject({
        avgCycleDays: 5,
        medianCycleDays: 5,
      });
    });
  });

  test("restates an earlier won period after a deal is reopened", async () => {
    await withTestDb(async (db) => {
      const f = await fixture(db);
      const deal = await f.add();
      expect((await f.read("won")).totals.count).toBe(1);
      await db.update(schema.deals).set({ status: "open" }).where(eq(schema.deals.id, deal.id));
      expect((await f.read("won")).totals.count).toBe(0);
      expect((await f.read("closed")).totals.count).toBe(0);
      expect((await f.read("open")).rows.map((row) => row.id)).toEqual([deal.id]);
    });
  });

  test("selects stored currency before counting as well as summing", async () => {
    await withTestDb(async (db) => {
      const f = await fixture(db);
      await f.add({ value: "7" });
      await f.add({ currency: "EUR", value: "900" });
      expect((await f.read("won")).totals).toEqual({ count: 1, value: "7.00", valueCount: 1 });
      const euro = await dealRecords(
        db,
        f.actor,
        { ...f.filters, currency: "EUR" },
        { metric: "won", limit: 25 },
        signal(),
      );
      expect(euro.totals).toEqual({ count: 1, value: "900.00", valueCount: 1 });
    });
  });

  test("excludes another owner's private records from both rows and full-population totals", async () => {
    await withTestDb(async (db) => {
      const f = await fixture(db);
      const other = await seedUser(db);
      await f.add();
      await f.add({ ownerId: other.id, visibilityLevel: "owner", value: "9999" });
      await f.add({ ownerId: other.id, visibilityLevel: "all", value: "2" });
      const page = await f.read("won", 1);
      expect(page.totals).toEqual({ count: 2, value: "12.00", valueCount: 2 });
      expect((await dealPerformance(db, f.actor, f.filters, signal())).won.value).toBe("12.00");
    });
  });

  test("all-pipeline records do not expose deals in a restricted pipeline even to their owner", async () => {
    await withTestDb(async (db) => {
      const f = await fixture(db);
      const [group] = await db
        .insert(schema.visibilityGroups)
        .values({ name: "Hidden" })
        .returning();
      if (group === undefined) throw new AppError(ERROR_IDS.DB_INSERT_FAILED, "Missing test group");
      const hidden = await seedPipelineWithStages(db, ["Secret"], { visibilityGroupId: group.id });
      const stage = hidden.stages[0];
      if (stage === undefined)
        throw new AppError(ERROR_IDS.DB_INSERT_FAILED, "Missing hidden stage");
      const visible = await f.add();
      await f.add({ pipelineId: hidden.pipeline.id, stageId: stage.id, value: "9999" });
      const page = await dealRecords(
        db,
        f.actor,
        { ...f.filters, pipelineId: null },
        { metric: "won", limit: 25 },
        signal(),
      );
      expect(page.rows.map((row) => row.id)).toEqual([visible.id]);
      expect(page.totals.value).toBe("10.00");
      await expect(
        f.caller.stats.records({
          ...RANGE,
          currency: "USD",
          pipelineId: hidden.pipeline.id,
          metric: "won",
        }),
      ).rejects.toMatchObject({ cause: { id: ERROR_IDS.STATS_PIPELINE_NOT_VISIBLE } });
    });
  });

  test("excludes archived or deleted deals and archived pipelines", async () => {
    await withTestDb(async (db) => {
      const f = await fixture(db);
      const active = await f.add();
      await f.add({ archivedAt: new Date() });
      await f.add({ deletedAt: new Date() });
      const archived = await seedPipelineWithStages(db, ["Old"], { isArchived: true });
      const stage = archived.stages[0];
      if (stage === undefined)
        throw new AppError(ERROR_IDS.DB_INSERT_FAILED, "Missing archived stage");
      await f.add({ pipelineId: archived.pipeline.id, stageId: stage.id });
      const page = await dealRecords(
        db,
        f.actor,
        { ...f.filters, pipelineId: null },
        { metric: "won", limit: 25 },
        signal(),
      );
      expect(page.rows.map((row) => row.id)).toEqual([active.id]);
      expect(page.totals.count).toBe(1);
    });
  });

  test("forces an unprivileged caller's requested all-owner scope back to me", async () => {
    await withTestDb(async (db) => {
      const f = await fixture(db);
      const other = await seedUser(db);
      const own = await f.add();
      await f.add({ ownerId: other.id });
      const page = await f.caller.stats.records({
        ...RANGE,
        currency: "USD",
        pipelineId: f.pipeline.id,
        ownerScope: { kind: "all" },
        metric: "won",
      });
      expect(page.effectiveOwnerScope).toEqual({ kind: "me" });
      expect(page.rows.map((row) => row.id)).toEqual([own.id]);
      expect(page.totals.count).toBe(1);
    });
  });

  test("keyset pages retain microseconds and use descending IDs to resolve equal timestamps", async () => {
    await withTestDb(async (db) => {
      const f = await fixture(db);
      const suffixes = ["1", "3", "2", "4"];
      const times = ["000002", "000001", "000001", "000000"];
      const ids: string[] = [];
      for (const [index, suffix] of suffixes.entries()) {
        const id = `00000000-0000-4000-8000-${suffix.padStart(12, "0")}`;
        const deal = await f.add({ id });
        await db.execute(
          sql`UPDATE deals SET created_at = ${`2026-01-01T00:00:00.${times[index]}Z`}::timestamptz WHERE id = ${deal.id}::uuid`,
        );
        ids.push(id);
      }
      const seen: string[] = [];
      let cursor: DealRecordsCursor | undefined;
      for (let index = 0; index < ids.length; index++) {
        const page = await f.read("won", 1, cursor);
        seen.push(...page.rows.map((row) => row.id));
        if (index === 0) expect(page.nextCursor?.createdAt).toBe("2026-01-01T00:00:00.000002Z");
        cursor = page.nextCursor ?? undefined;
        if (index === ids.length - 1) expect(page.nextCursor).toBeNull();
      }
      expect(seen).toEqual(ids);
      expect(new Set(seen).size).toBe(4);
    });
  });

  test("returns an empty terminal page with the complete eligible totals", async () => {
    await withTestDb(async (db) => {
      const f = await fixture(db);
      await f.add();
      const first = await f.read("won");
      const last = first.rows[0];
      if (last === undefined)
        throw new AppError(ERROR_IDS.DB_INSERT_FAILED, "Missing first record");
      const terminal = await f.read("won", 25, { createdAt: last.createdAt, id: last.id });
      expect(terminal.rows).toEqual([]);
      expect(terminal.nextCursor).toBeNull();
      expect(terminal.totals).toEqual(first.totals);
    });
  });

  test("resolves viewer timezone on the server and includes exactly the local-day endpoints", async () => {
    await withTestDb(async (db) => {
      const f = await fixture(db);
      await setPreferences(db, f.user.id, { timezone: "Asia/Tehran" }, signal());
      await f.add({ wonTime: new Date("2026-05-31T20:29:59.999Z") });
      const start = await f.add({ wonTime: new Date("2026-05-31T20:30:00Z") });
      const end = await f.add({ wonTime: new Date("2026-06-01T20:29:59.999Z") });
      await f.add({ wonTime: new Date("2026-06-01T20:30:00Z") });
      const page = await f.caller.stats.records({
        from: "2026-06-01",
        to: "2026-06-01",
        currency: "USD",
        pipelineId: f.pipeline.id,
        metric: "won",
      });
      expect(page.timeZone).toBe("Asia/Tehran");
      expect(page.rows.map((row) => row.id).sort()).toEqual([start.id, end.id].sort());
      expect(page.totals.count).toBe(2);
    });
  });

  test.each([
    ["2026-03-29", 23],
    ["2026-10-25", 25],
  ] as const)("%s has a %i-hour Berlin reporting day", async (day, hours) => {
    await withTestDb(async (db) => {
      const period = reportPeriod({ from: day, to: day, timeZone: "Europe/Berlin" });
      await db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL TIME ZONE 'Pacific/Honolulu'`);
        const result = await tx.execute(
          sql`SELECT (extract(epoch FROM (${period.toExclusive} - ${period.from})) / 3600)::float8 AS hours`,
        );
        expect((result.rows[0] as { hours: number } | undefined)?.hours).toBe(hours);
      });
    });
  });
});
