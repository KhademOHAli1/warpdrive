import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { DATE_PRESET_KEYS } from "@/constants/dateFilterPresets";
import { ERROR_IDS } from "@/constants/errorIds";
import { type FilterCompileOptions, filterToSql } from "./filterAst";
import type { FilterDefinition } from "./schemas";

type Condition = FilterDefinition["conditions"][number];
const dialect = new PgDialect();
const NY = "America/New_York";
const NOW = new Date("2026-09-02T16:00:00Z");
function emit(c: Condition, timeZone?: string | null, context: FilterCompileOptions = {}) {
  return dialect.sqlToQuery(filterToSql({ conditions: [c] }, { now: NOW, timeZone, ...context }));
}

describe("date predicates preserve column kinds, half-open bounds and null semantics", () => {
  it("matches an absolute civil day in the viewer zone for timestamps", () => {
    const q = emit({ field: "nextActivityAt", op: "eq", value: "2026-09-02" }, NY);
    expect(q.sql).toBe(
      "(d.next_activity_at >= (($1::date)::timestamp AT TIME ZONE $2) AND d.next_activity_at < (($3::date + 1)::timestamp AT TIME ZONE $4))",
    );
    expect(q.params).toEqual(["2026-09-02", NY, "2026-09-02", NY]);
  });
  it("compares date columns as plain Gregorian civil dates regardless of display calendar", () => {
    const q = emit({ field: "expectedCloseDate", op: "eq", value: "2026-09-30" }, NY, {
      calendar: "persian",
      locale: "fa",
    });
    expect(q.sql).toBe(
      "(d.expected_close_date >= $1::date AND d.expected_close_date < $2::date + 1)",
    );
    expect(q.params).toEqual(["2026-09-30", "2026-09-30"]);
  });
  it("maps every ordered absolute-date operator onto the same range bounds", () => {
    const f = "expectedCloseDate",
      value = "2026-09-02",
      col = "d.expected_close_date";
    expect(emit({ field: f, op: "gt", value }).sql).toBe(`${col} >= $1::date + 1`);
    expect(emit({ field: f, op: "gte", value }).sql).toBe(`${col} >= $1::date`);
    expect(emit({ field: f, op: "lt", value }).sql).toBe(`${col} < $1::date`);
    expect(emit({ field: f, op: "lte", value }).sql).toBe(`${col} < $1::date + 1`);
    expect(emit({ field: f, op: "neq", value }).sql).toBe(
      `(${col} IS NULL OR ${col} < $1::date OR ${col} >= $2::date + 1)`,
    );
  });
  it("binds Gregorian week/month/rolling bounds resolved from the injected clock", () => {
    expect(emit({ field: "expectedCloseDate", op: "eq", value: "today" }, NY).params).toEqual([
      "2026-09-02",
      "2026-09-03",
    ]);
    expect(emit({ field: "expectedCloseDate", op: "eq", value: "this_week" }, NY).params).toEqual([
      "2026-08-31",
      "2026-09-07",
    ]);
    expect(emit({ field: "expectedCloseDate", op: "eq", value: "last_month" }, NY).params).toEqual([
      "2026-08-01",
      "2026-09-01",
    ]);
    expect(emit({ field: "expectedCloseDate", op: "eq", value: "last_7_days" }, NY).params).toEqual(
      ["2026-08-27", "2026-09-03"],
    );
  });
  it("binds Solar Hijri month bounds and preserves all six operator contracts", () => {
    const context = {
      calendar: "persian" as const,
      locale: "fa" as const,
      now: new Date("2026-03-21T12:00:00Z"),
    };
    const condition = { field: "expectedCloseDate" as const, value: "this_month" };
    const eq = emit({ ...condition, op: "eq" }, "Asia/Tehran", context);
    expect(eq.sql).toBe("(d.expected_close_date >= $1::date AND d.expected_close_date < $2::date)");
    expect(eq.params).toEqual(["2026-03-21", "2026-04-21"]);
    const neq = emit({ ...condition, op: "neq" }, "Asia/Tehran", context);
    expect(neq.sql).toBe(
      "(d.expected_close_date IS NULL OR d.expected_close_date < $1::date OR d.expected_close_date >= $2::date)",
    );
    expect(neq.params).toEqual(eq.params);
    for (const [op, bound, comparison] of [
      ["gt", "2026-04-21", ">="],
      ["gte", "2026-03-21", ">="],
      ["lt", "2026-03-21", "<"],
      ["lte", "2026-04-21", "<"],
    ] as const) {
      const q = emit({ ...condition, op }, "Asia/Tehran", context);
      expect(q.sql).toBe(`d.expected_close_date ${comparison} $1::date`);
      expect(q.params).toEqual([bound]);
    }
  });
  it("converts both resolved timestamp boundaries in PostgreSQL, retaining timezone transitions", () => {
    const q = emit({ field: "nextActivityAt", op: "eq", value: "today" }, NY);
    expect(q.sql).toBe(
      "(d.next_activity_at >= (($1::date)::timestamp AT TIME ZONE $2) AND d.next_activity_at < (($3::date)::timestamp AT TIME ZONE $4))",
    );
    expect(q.params).toEqual(["2026-09-02", NY, "2026-09-03", NY]);
  });
  it("anchors every condition to one injectable clock and resolves Tehran midnight", () => {
    const q = dialect.sqlToQuery(
      filterToSql(
        {
          conditions: [
            { field: "expectedCloseDate", op: "eq", value: "today" },
            { field: "nextActivityAt", op: "eq", value: "this_month" },
          ],
        },
        {
          calendar: "persian",
          locale: "fa",
          timeZone: "Asia/Tehran",
          now: new Date("2026-03-20T20:30:00Z"),
        },
      ),
    );
    expect(q.params).toEqual([
      "2026-03-21",
      "2026-03-22",
      "2026-03-21",
      "Asia/Tehran",
      "2026-04-21",
      "Asia/Tehran",
    ]);
  });
  it("uses UTC for missing or invalid zones", () => {
    for (const zone of [undefined, null, "Mars/Olympus"]) {
      expect(emit({ field: "nextActivityAt", op: "gte", value: "today" }, zone).params).toEqual([
        "2026-09-02",
        "UTC",
      ]);
    }
  });
  it("keeps every preset and all user-supplied dates out of SQL text", () => {
    for (const key of DATE_PRESET_KEYS) {
      const q = emit({ field: "nextActivityAt", op: "eq", value: key }, NY);
      expect(q.sql).not.toContain(key);
      expect(q.params).toHaveLength(4);
      expect(q.params[1]).toBe(NY);
      expect(q.params[3]).toBe(NY);
      expect(q.params[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(q.params[2]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
  it("rejects invalid dates and list values while keeping emptiness a plain null test", () => {
    for (const value of ["soon", "2026-02-30", "2026-9-2", ["2026-09-02"]]) {
      expect(() => emit({ field: "nextActivityAt", op: "eq", value })).toThrow(
        expect.objectContaining({ id: ERROR_IDS.DEAL_FILTER_INVALID }),
      );
    }
    expect(emit({ field: "nextActivityAt", op: "isEmpty" }).sql).toBe("d.next_activity_at IS NULL");
    expect(emit({ field: "lastActivityAt", op: "isNotEmpty" }).sql).toBe(
      "NOT (d.last_activity_at IS NULL)",
    );
  });
});
