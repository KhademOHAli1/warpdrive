import { describe, expect, test } from "vitest";
import { serializeDealReportExport } from "./dealReportExportCsv";
import {
  DEAL_REPORT_EXPORT_LIMIT,
  type DealReportExportScope,
  dealReportExportHref,
  parseDealReportExportRequest,
} from "./dealReportExportRequest";

const scope: DealReportExportScope = {
  currency: "EUR",
  ownerScope: { kind: "me" },
  pipelineId: null,
  from: "2026-03-01",
  to: "2026-03-31",
  metric: "won",
  timeZone: "Europe/Berlin",
};
const prefix = "https://example.invalid";
const createdAt = "2026-02-12T01:00:00.123456Z";
const closedAt = "2026-03-12T01:00:00.654321Z";
const header = "deal_id,status,currency,value,created_at_utc,closed_at_utc";

function row(index: number, value: string | null) {
  return {
    id: `d1111111-1111-4111-8111-${String(index).padStart(12, "0")}`,
    title: '=HYPERLINK("https://private.invalid")\r\nextra,row',
    status: "won",
    currency: "EUR",
    value,
    createdAt,
    closedAt,
    ownerId: "do-not-export-owner",
  };
}

function fixture(rows: ReturnType<typeof row>[], value: string, valueCount: number) {
  return {
    metric: "won",
    definitionVersion: 1,
    currency: "EUR",
    effectiveOwnerScope: { kind: "me" },
    timeZone: scope.timeZone,
    nextCursor: null,
    totals: { count: rows.length, value, valueCount },
    rows,
  };
}

describe("bounded deal report CSV", () => {
  test("binds a won trend bucket and its original dates through the export", () => {
    const monthScope = { ...scope, from: "2026-02-15", wonMonth: "2026-03" };
    const href = dealReportExportHref(monthScope);
    expect(parseDealReportExportRequest(new URL(`${prefix}${href}`))).toEqual(monthScope);
    expect(dealReportExportHref({ ...monthScope, metric: "lost" })).toBeNull();
    expect(dealReportExportHref({ ...monthScope, wonMonth: "2026-01" })).toBeNull();
    const report = fixture([row(1, "1.00")], "1.00", 1);
    expect(serializeDealReportExport(report, monthScope)).toEqual({ state: "invalid" });
    expect(
      serializeDealReportExport({ ...report, wonMonth: monthScope.wonMonth }, monthScope),
    ).toMatchObject({ state: "ready" });
  });

  test("round trips exact civil dates and the required pipeline and owner selectors", () => {
    const href = dealReportExportHref(scope);
    expect(href).toMatch(/^\/dashboard\/export\?/);
    expect(parseDealReportExportRequest(new URL(`${prefix}${href}`))).toEqual(scope);
    const singlePipeline = {
      ...scope,
      pipelineId: "e1111111-1111-4111-8111-111111111111",
      ownerScope: { kind: "all" } as const,
    };
    expect(
      parseDealReportExportRequest(new URL(`${prefix}${dealReportExportHref(singlePipeline)}`)),
    ).toEqual(singlePipeline);
    for (const ownerScope of [
      { kind: "user", userId: "f1111111-1111-4111-8111-111111111111" },
      { kind: "team", teamId: "a1111111-1111-4111-8111-111111111111" },
    ] as const) {
      const selectedOwner = { ...scope, ownerScope };
      expect(
        parseDealReportExportRequest(new URL(`${prefix}${dealReportExportHref(selectedOwner)}`)),
      ).toEqual(selectedOwner);
    }
  });

  test.each([
    "&from=2026-03-02",
    "&%66rom=2026-03-01",
    "&metric=won",
    "&cursor=anything",
    "&teamId=f1111111-1111-4111-8111-111111111111",
    "&__proto__=x",
    `&oversize=${"x".repeat(256)}`,
  ])("rejects repeated, extra or oversized input %s", (tail) => {
    expect(
      parseDealReportExportRequest(new URL(`${prefix}${dealReportExportHref(scope)}${tail}`)),
    ).toBeNull();
  });

  test.each([
    ["from", "0000-01-01"],
    ["from", "2026-03-32"],
    ["to", "2026-02-01"],
    ["currency", "eur"],
    ["currency", "ZZZ"],
    ["pipelineId", ""],
    ["ownerScope", "team"],
    ["metric", "invented"],
    ["timeZone", "+01:00"],
  ] as const)("rejects an invalid %s", (key, value) => {
    const url = new URL(`${prefix}${dealReportExportHref(scope)}`);
    url.searchParams.set(key, value);
    expect(parseDealReportExportRequest(url)).toBeNull();
  });

  test("retains raw negative decimals, zero, null and UTC microseconds after exact reconciliation", () => {
    const rows = [
      row(1, "99999999999999.1234"),
      row(2, "-99999999999999.1233"),
      row(3, "0.00"),
      row(4, null),
    ];
    const result = serializeDealReportExport(fixture(rows, "0.0001", 3), scope);
    expect(result).toEqual({
      state: "ready",
      csv: [
        header,
        `d1111111-1111-4111-8111-000000000001,won,EUR,99999999999999.1234,${createdAt},${closedAt}`,
        `d1111111-1111-4111-8111-000000000002,won,EUR,-99999999999999.1233,${createdAt},${closedAt}`,
        `d1111111-1111-4111-8111-000000000003,won,EUR,0.00,${createdAt},${closedAt}`,
        `d1111111-1111-4111-8111-000000000004,won,EUR,,${createdAt},${closedAt}`,
        "",
      ].join("\r\n"),
    });
  });

  test("accepts an empty complete population and exactly 100 rows", () => {
    expect(serializeDealReportExport(fixture([], "0.00", 0), scope)).toEqual({
      state: "ready",
      csv: `${header}\r\n`,
    });
    const rows = Array.from({ length: DEAL_REPORT_EXPORT_LIMIT }, (_, i) => row(i, "0.01"));
    const result = serializeDealReportExport(
      fixture(rows, "1.00", DEAL_REPORT_EXPORT_LIMIT),
      scope,
    );
    if (result.state !== "ready") throw new Error("Expected a complete CSV");
    expect(result.csv.trimEnd().split("\r\n")).toHaveLength(DEAL_REPORT_EXPORT_LIMIT + 1);
    expect(
      serializeDealReportExport(
        {
          ...fixture(rows, "1.01", DEAL_REPORT_EXPORT_LIMIT + 1),
          totals: {
            count: DEAL_REPORT_EXPORT_LIMIT + 1,
            value: "1.01",
            valueCount: DEAL_REPORT_EXPORT_LIMIT + 1,
          },
          nextCursor: { createdAt, id: row(99, "0.01").id },
        },
        scope,
      ),
    ).toEqual({ state: "too-large" });
  });

  test("refuses missing pages, count or sum disagreement, repeated IDs and mismatched scope", () => {
    const first = row(1, "1.0001");
    const report = fixture([first], "1.0001", 1);
    const invalid = { state: "invalid" };
    for (const changed of [
      { ...report, nextCursor: { createdAt, id: first.id } },
      { ...report, totals: { ...report.totals, count: 2 } },
      { ...report, totals: { ...report.totals, valueCount: 0 } },
      { ...report, totals: { ...report.totals, value: "1.00" } },
      fixture([first, first], "2.0002", 2),
      { ...report, currency: "USD" },
      { ...report, effectiveOwnerScope: { kind: "all" } },
      { ...report, timeZone: "UTC" },
      { ...report, definitionVersion: 2 },
    ]) {
      expect(serializeDealReportExport(changed, scope)).toEqual(invalid);
    }
  });

  test("refuses formula, line-break, mixed currency and non-UTC values in projected fields", () => {
    const first = row(1, "1.00");
    const report = fixture([first], "1.00", 1);
    for (const fields of [
      { value: "-1+1" },
      { value: "=2+2" },
      { value: "1.00\r\nother,record" },
      { value: "1.2345\n" },
      { id: `${first.id}\r` },
      { currency: "USD" },
      { status: "lost" },
      { closedAt: "2026-03-12T02:00:00.654321+01:00" },
    ]) {
      expect(
        serializeDealReportExport({ ...report, rows: [{ ...first, ...fields }] }, scope),
      ).toEqual({ state: "invalid" });
    }
  });

  test("exports open inventory and applies the metric-specific record contract", () => {
    const first = { ...row(1, null), status: "open", closedAt: null };
    const report = { ...fixture([], "0.00", 0), metric: "open", rows: [first] };
    const totals = { count: 1, value: "0.00", valueCount: 0 };
    expect(serializeDealReportExport({ ...report, totals }, { ...scope, metric: "open" })).toEqual({
      state: "ready",
      csv: `${header}\r\n${first.id},open,EUR,,${createdAt},\r\n`,
    });
    expect(serializeDealReportExport({ ...report, totals }, { ...scope, metric: "won" })).toEqual({
      state: "invalid",
    });
    const malformedCycle = {
      ...fixture([{ ...row(1, "1.00"), createdAt: closedAt, closedAt: createdAt }], "1.00", 1),
      metric: "wonCycle",
    };
    expect(serializeDealReportExport(malformedCycle, { ...scope, metric: "wonCycle" })).toEqual({
      state: "invalid",
    });
  });
});
