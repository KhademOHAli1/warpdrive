import { TRPCError } from "@trpc/server";
import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { PermissionFlagKey } from "@/constants/permissionFlags";
import { db, pool } from "@/db/client";
import type { HydratedActor } from "@/server/hydrateActor";
import type { AppContext } from "@/server/trpc/context";
import type { createCaller } from "@/server/trpc/root";

type ReadRecords = ReturnType<typeof createCaller>["stats"]["records"];
type Report = Awaited<ReturnType<ReadRecords>>;

const boundary = vi.hoisted(() => ({
  context: vi.fn<() => Promise<AppContext>>(),
  caller: vi.fn<(ctx: AppContext) => { stats: { records: ReadRecords } }>(),
  records: vi.fn<ReadRecords>(),
}));
vi.mock("@/server/trpc/context", () => ({ createContext: boundary.context }));
vi.mock("@/server/trpc/root", () => ({ createCaller: boundary.caller }));

import { GET } from "./route";

const userId = "a7111111-1111-4111-8111-111111111111";
const dealId = "d7111111-1111-4111-8111-111111111111";
const pipelineId = "e7111111-1111-4111-8111-111111111111";
const actor: HydratedActor = {
  id: userId,
  type: "regular",
  isActive: true,
  flags: new Set(["data.export", "stats.viewOthers"]),
  groupIds: new Set(["fixture-group"]),
  name: "Export operator",
  email: "operator@example.invalid",
  avatarUrl: null,
};
const liveContext: AppContext = {
  db,
  actor,
  session: { userId, sessionId: "fixture-session" },
  localeFallback: { timeZone: "America/Los_Angeles" },
};
const permittedReport: Report = {
  currency: "EUR",
  metric: "won",
  definitionVersion: 1,
  effectiveOwnerScope: { kind: "all" },
  timeZone: "America/Los_Angeles",
  generatedAt: "2026-04-01T00:00:00.000Z",
  rows: [
    {
      id: dealId,
      title: '=HYPERLINK("https://private.invalid")\r\nnext,row',
      currency: "EUR",
      status: "won",
      value: "-1.2345",
      createdAt: "2026-02-01T00:00:00.111111Z",
      closedAt: "2026-03-01T09:00:00.222222Z",
    },
  ],
  totals: { count: 1, value: "-1.2345", valueCount: 1 },
  nextCursor: null,
};

const query = new URLSearchParams({
  from: "2026-03-01",
  to: "2026-03-31",
  pipelineId,
  currency: "EUR",
  ownerScope: "all",
  metric: "won",
  timeZone: "America/Los_Angeles",
});

function download(tail = ""): Promise<Response> {
  return GET(new NextRequest(`https://example.invalid/dashboard/export?${query}${tail}`));
}

function expectNoDownload(response: Response, status: number): void {
  expect(response.status).toBe(status);
  expect(response.headers.get("content-disposition")).toBeNull();
  expect(response.headers.get("cache-control")).toBe("private, no-store");
}

beforeEach(() => {
  boundary.context.mockReset().mockResolvedValue(liveContext);
  boundary.caller.mockReset().mockReturnValue({ stats: { records: boundary.records } });
  boundary.records.mockReset().mockResolvedValue(permittedReport);
});
afterAll(async () => pool.end());

describe("Deal report download authorization", () => {
  test.each([
    { ...liveContext, actor: null },
    { ...liveContext, session: null },
    { ...liveContext, session: { userId: dealId, sessionId: "fixture-session" } },
  ])("requires the current actor and matching native session", async (ctx) => {
    boundary.context.mockResolvedValue(ctx);
    expectNoDownload(await download(), 401);
    expect(boundary.caller).not.toHaveBeenCalled();
    expect(boundary.records).not.toHaveBeenCalled();
  });

  test.each([
    { ...actor, flags: new Set<PermissionFlagKey>() },
    { ...actor, isActive: false },
  ])("requires current data.export from an active actor", async (candidate) => {
    boundary.context.mockResolvedValue({ ...liveContext, actor: candidate });
    expectNoDownload(await download(), 403);
    expect(boundary.caller).not.toHaveBeenCalled();
  });

  test("invokes the authorized records procedure once with the fresh viewer and no cursor", async () => {
    const response = await download();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="deal-report-won.csv"',
    );
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(boundary.caller).toHaveBeenCalledExactlyOnceWith(liveContext);
    expect(boundary.records).toHaveBeenCalledExactlyOnceWith({
      metric: "won",
      limit: 100,
      from: "2026-03-01",
      to: "2026-03-31",
      pipelineId,
      currency: "EUR",
      ownerScope: { kind: "all" },
    });
    expect(await response.text()).toBe(
      "deal_id,status,currency,value,created_at_utc,closed_at_utc\r\n" +
        `${dealId},won,EUR,-1.2345,2026-02-01T00:00:00.111111Z,2026-03-01T09:00:00.222222Z\r\n`,
    );
  });

  test("reauthorizes a repeated request after export permission changes", async () => {
    boundary.context.mockResolvedValueOnce(liveContext).mockResolvedValueOnce({
      ...liveContext,
      actor: { ...actor, flags: new Set() },
    });
    expect((await download()).status).toBe(200);
    expectNoDownload(await download(), 403);
    expect(boundary.context).toHaveBeenCalledTimes(2);
    expect(boundary.records).toHaveBeenCalledTimes(1);
  });

  test.each(["&metric=lost", "&pipelineId=all", "&%66rom=2026-03-01", "&cursor=raw"])(
    "refuses a repeated or extra parameter before data reads",
    async (tail) => {
      expectNoDownload(await download(tail), 400);
      expect(boundary.caller).not.toHaveBeenCalled();
    },
  );

  test("withholds hidden pipelines without exposing their authorization details", async () => {
    boundary.records.mockRejectedValue(
      new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        cause: new AppError(ERROR_IDS.STATS_PIPELINE_NOT_VISIBLE, `Private pipeline ${pipelineId}`),
      }),
    );
    const response = await download();
    expectNoDownload(response, 404);
    expect(await response.text()).toBe("Export unavailable");
  });

  test("refuses oversized and unreconciled reads without starting another page", async () => {
    boundary.records
      .mockResolvedValueOnce({
        ...permittedReport,
        totals: { count: 101, value: "-1.2345", valueCount: 1 },
        nextCursor: { createdAt: "2026-02-01T00:00:00.111111Z", id: dealId },
      })
      .mockResolvedValueOnce({
        ...permittedReport,
        totals: { count: 1, value: "-1.2344", valueCount: 1 },
      });
    expectNoDownload(await download(), 422);
    expectNoDownload(await download(), 503);
    expect(boundary.records).toHaveBeenCalledTimes(2);
  });

  test("refuses a changed report time zone or owner grant before returning any data", async () => {
    boundary.records
      .mockResolvedValueOnce({ ...permittedReport, effectiveOwnerScope: { kind: "me" } })
      .mockResolvedValueOnce({ ...permittedReport, timeZone: "UTC" });
    expectNoDownload(await download(), 503);
    expectNoDownload(await download(), 503);
  });
});
