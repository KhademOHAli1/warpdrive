import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, test } from "vitest";
import type { DashboardFilters } from "@/types/stats";
import { dealMetricPopulation } from "./dealPopulation";
import { reportPeriod } from "./reportPeriod";
import { dashboardInput, dealRecordsInput } from "./schemas";

const dialect = new PgDialect();
const FILTERS: DashboardFilters = {
  from: "2026-03-29",
  to: "2026-03-29",
  timeZone: "Europe/Berlin",
  pipelineId: null,
  owners: { everyone: true },
};
const CURSOR = {
  createdAt: "2026-06-01T12:00:00.123456Z",
  id: "00000000-0000-4000-8000-000000000001",
};
const INPUT = { from: "2026-06-01", to: "2026-06-30", metric: "won" as const };

describe("explicit report period SQL", () => {
  test("binds both civil midnights to the explicit viewer zone", () => {
    const period = reportPeriod(FILTERS);
    expect(dialect.sqlToQuery(period.from)).toMatchObject({
      sql: "($1::date::timestamp AT TIME ZONE $2)",
      params: ["2026-03-29", "Europe/Berlin"],
    });
    expect(dialect.sqlToQuery(period.toExclusive)).toMatchObject({
      sql: "(($1::date + 1)::timestamp AT TIME ZONE $2)",
      params: ["2026-03-29", "Europe/Berlin"],
    });
  });

  test("defaults direct query calls to UTC without relying on a database session zone", () => {
    const period = reportPeriod({ from: FILTERS.from, to: FILTERS.to });
    expect(dialect.sqlToQuery(period.from).params).toEqual([FILTERS.from, "UTC"]);
    expect(dialect.sqlToQuery(period.toExclusive).params).toEqual([FILTERS.to, "UTC"]);
  });

  test.each(["2026-03-29", "2026-10-25"])(
    "advances the civil end date before timezone conversion on %s",
    (day) => {
      const query = dialect.sqlToQuery(
        reportPeriod({ ...FILTERS, from: day, to: day }).toExclusive,
      );
      expect(query.sql).toContain("::date + 1)::timestamp AT TIME ZONE");
      expect(query.sql).not.toContain("INTERVAL");
      expect(query.params).toEqual([day, "Europe/Berlin"]);
    },
  );

  test("keeps closed-period populations on their respective close timestamps", () => {
    const won = dialect.sqlToQuery(dealMetricPopulation("won", FILTERS));
    const lost = dialect.sqlToQuery(dealMetricPopulation("lost", FILTERS));
    const closed = dialect.sqlToQuery(dealMetricPopulation("closed", FILTERS));
    expect(won.sql).toContain("d.status = 'won' AND d.won_time >=");
    expect(lost.sql).toContain("d.status = 'lost' AND d.lost_time >=");
    expect(closed.sql).toContain(" OR ");
    expect(closed.sql).toContain("d.won_time <");
    expect(closed.sql).toContain("d.lost_time <");
    expect(closed.params).toEqual([
      FILTERS.from,
      FILTERS.timeZone,
      FILTERS.to,
      FILTERS.timeZone,
      FILTERS.from,
      FILTERS.timeZone,
      FILTERS.to,
      FILTERS.timeZone,
    ]);
  });

  test("distinguishes non-null money eligibility from nonnegative won-cycle eligibility", () => {
    const valued = dialect.sqlToQuery(dealMetricPopulation("wonValue", FILTERS));
    const cycle = dialect.sqlToQuery(dealMetricPopulation("wonCycle", FILTERS));
    expect(valued.sql).toContain("d.value IS NOT NULL");
    expect(valued.sql).not.toContain("d.won_time >= d.created_at");
    expect(cycle.sql).toContain("d.won_time >= d.created_at");
    expect(cycle.sql).not.toContain("d.value IS NOT NULL");
  });

  test("does not window current open inventory or require a status for created-date entrants", () => {
    expect(dialect.sqlToQuery(dealMetricPopulation("open", FILTERS))).toMatchObject({
      sql: "d.status = 'open'",
      params: [],
    });
    const added = dialect.sqlToQuery(dealMetricPopulation("added", FILTERS));
    expect(added.sql).toContain("d.created_at >=");
    expect(added.sql).not.toContain("d.status");
  });
});

describe("report input boundaries", () => {
  test("rejects reversed dates on both the dashboard and record endpoint", () => {
    const reversed = { from: "2026-07-01", to: "2026-06-30", metric: "won" };
    expect(dashboardInput.safeParse(reversed).success).toBe(false);
    expect(dealRecordsInput.safeParse(reversed).success).toBe(false);
  });

  test("bounds page size and requires a supported metric", () => {
    for (const limit of [0, -1, 101, 1.5]) {
      expect(dealRecordsInput.safeParse({ ...INPUT, limit }).success).toBe(false);
    }
    expect(dealRecordsInput.parse(INPUT).limit).toBe(25);
    expect(dealRecordsInput.safeParse({ ...INPUT, limit: 100 }).success).toBe(true);
    expect(dealRecordsInput.safeParse({ ...INPUT, metric: "arbitrarySql" }).success).toBe(false);
  });

  test("preserves cursor microseconds but rejects invalid cursor values", () => {
    expect(dealRecordsInput.parse({ ...INPUT, cursor: CURSOR }).cursor).toEqual(CURSOR);
    for (const cursor of [
      { ...CURSOR, createdAt: "not-an-instant" },
      { ...CURSOR, createdAt: "2026-06-01" },
      { ...CURSOR, id: "not-a-uuid" },
    ]) {
      expect(dealRecordsInput.safeParse({ ...INPUT, cursor }).success).toBe(false);
    }
  });

  test("drops client claims about timezone, resolved owners, totals and cursor scope", () => {
    const parsed = dealRecordsInput.parse({
      ...INPUT,
      timeZone: "Pacific/Honolulu",
      owners: { everyone: true },
      totals: { count: 999 },
      cursor: { ...CURSOR, ownerScope: { kind: "all" }, definitionVersion: 999 },
    });
    expect(parsed).not.toHaveProperty("timeZone");
    expect(parsed).not.toHaveProperty("owners");
    expect(parsed).not.toHaveProperty("totals");
    expect(parsed.cursor).toEqual(CURSOR);
    expect(parsed.ownerScope).toEqual({ kind: "me" });
  });
});
