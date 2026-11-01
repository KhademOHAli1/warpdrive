import { NextRequest } from "next/server";
import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import type { PermissionFlagKey } from "@/constants/permissionFlags";
import { db, pool } from "@/db/client";
import type { LeadRow, listLeadsForExport } from "@/features/leads/leadRepo";
import type { readBaseCurrency } from "@/features/settings/readBaseCurrency";
import type { HydratedActor } from "@/server/hydrateActor";
import type { AppContext } from "@/server/trpc/context";

const boundary = vi.hoisted(() => ({
  context: vi.fn<() => Promise<AppContext>>(),
  currency: vi.fn<typeof readBaseCurrency>(),
  export: vi.fn<typeof listLeadsForExport>(),
}));
vi.mock("@/server/trpc/context", () => ({ createContext: boundary.context }));
// Substitute domain read commands, never database operations or a query builder. The route uses
// the actual Drizzle/Pool instance, which remains unconnected in these authorization unit tests.
vi.mock("@/features/settings/readBaseCurrency", () => ({ readBaseCurrency: boundary.currency }));
vi.mock("@/features/leads/leadRepo", () => ({ listLeadsForExport: boundary.export }));

import { GET } from "./route";

const USER_ID = "f7b11111-1111-4111-8111-111111111111";
const permittedActor: HydratedActor = {
  id: USER_ID,
  type: "regular",
  isActive: true,
  flags: new Set(["data.export"]),
  groupIds: new Set(["visibility-group"]),
  managedUserIds: new Set(["managed-user"]),
  name: "Export operator",
  email: "operator@example.test",
  avatarUrl: null,
};
const nativeSession = { userId: USER_ID, sessionId: "native-session" };
const row: LeadRow = {
  id: "lead",
  title: "Acme, Inc",
  value: "12.345",
  currency: "KWD",
  labels: ["Hot", "Warm"],
  sourceOrigin: "manually_created",
  personName: null,
  orgName: null,
  ownerName: "@owner",
  nextActivityAt: new Date("2026-11-02T10:00:00Z"),
  createdAt: new Date("2026-10-31T10:00:00Z"),
  archivedAt: null,
  updatedAt: new Date("2026-11-01T10:00:00Z"),
  convertedDealId: null,
  customFields: {},
};

function context(actor: HydratedActor | null = permittedActor): AppContext {
  return { db, actor, session: nativeSession };
}
function request(params: Record<string, string> = {}): Promise<Response> {
  return GET(new NextRequest(`http://localhost/leads/export?${new URLSearchParams(params)}`));
}
function expectNoDataReads(): void {
  expect(boundary.currency).not.toHaveBeenCalled();
  expect(boundary.export).not.toHaveBeenCalled();
}

beforeEach(() => {
  boundary.context.mockReset().mockResolvedValue(context());
  boundary.currency.mockReset().mockResolvedValue("EUR");
  boundary.export.mockReset().mockResolvedValue([row]);
});
afterAll(async () => pool.end());

test.each([
  ["missing actor", context(null)],
  ["missing native session", { ...context(), session: null }],
  [
    "admin without a native session",
    { ...context({ ...permittedActor, type: "admin", flags: new Set() }), session: null },
  ],
] as const)("rejects %s before currency or lead reads", async (_label, ctx) => {
  boundary.context.mockResolvedValue(ctx);
  const response = await request();
  expect(response.status).toBe(401);
  expectNoDataReads();
});

test.each([
  ["inactive member", { ...permittedActor, isActive: false }],
  ["inactive admin", { ...permittedActor, type: "admin", isActive: false }],
  ["active member without data.export", { ...permittedActor, flags: new Set<PermissionFlagKey>() }],
] as const)("denies %s before currency or lead reads", async (_label, actor) => {
  boundary.context.mockResolvedValue(context(actor));
  const response = await request();
  expect(response.status).toBe(403);
  expect(await response.text()).toBe(ERROR_IDS.PERM_DENIED);
  expectNoDataReads();
});

test("forwards validated filters, sort and native visibility to the existing export command", async () => {
  const condition = {
    combinator: "and",
    conditions: [{ field: "title", op: "contains", value: "Acme" }],
  };
  const response = await request({
    filter: "archived",
    sortField: "cf:region",
    sortDir: "asc",
    ownerIds: USER_ID,
    labelKeys: "Hot,Warm",
    nextActivity: "today",
    condition: JSON.stringify(condition),
    columns: "owner,title,value,nextActivity,labels,sourceOrigin,createdAt,unknown",
  });
  expect(response.status).toBe(200);
  expect(boundary.context).toHaveBeenCalledOnce();
  expect(boundary.currency).toHaveBeenCalledExactlyOnceWith(db, expect.any(AbortSignal));
  expect(boundary.export).toHaveBeenCalledExactlyOnceWith(
    db,
    {
      userId: USER_ID,
      isAdmin: false,
      isActive: true,
      sessionLive: true,
      visibilityGroupIds: ["visibility-group"],
      managedUserIds: ["managed-user"],
    },
    {
      filter: "archived",
      offset: 0,
      limit: 500,
      sort: { field: "cf:region", dir: "asc" },
      filters: {
        ownerIds: [USER_ID],
        labelKeys: ["Hot", "Warm"],
        nextActivity: "today",
        condition,
      },
    },
    boundary.currency.mock.calls[0]?.[1],
  );
  expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
  expect(response.headers.get("content-disposition")).toBe('attachment; filename="leads.csv"');
  expect(await response.text()).toBe(
    'Owner,Title,Value,Next activity,Labels,Source origin,Lead created,Currency\n\'@owner,"Acme, Inc",12.345,2026-11-02,"Hot, Warm",manually created,2026-10-31,KWD',
  );
});

test("allows an active admin without export flags and retains base-currency fallback", async () => {
  boundary.context.mockResolvedValue(
    context({ ...permittedActor, type: "admin", flags: new Set() }),
  );
  boundary.export.mockResolvedValue([{ ...row, currency: undefined }]);
  const response = await request({ columns: "value" });
  expect(response.status).toBe(200);
  expect(await response.text()).toBe("Value,Currency\n12.345,EUR");
  expect(boundary.export.mock.calls[0]?.[1]).toMatchObject({ isAdmin: true, sessionLive: true });
});

test.each([
  ["filter", "unknown"],
  ["sortField", "bogus"],
  ["sortDir", "sideways"],
])("keeps invalid authorized query input at 400 before data reads: %j", async (key, value) => {
  const response = await request({ [key]: value });
  expect(response.status).toBe(400);
  expect(await response.text()).toBe("Bad request");
  expectNoDataReads();
});

test("keeps read failures at 500 without exposing internal details", async () => {
  boundary.export.mockRejectedValue(new Error("private database details"));
  const response = await request({ columns: "title" });
  expect(response.status).toBe(500);
  expect(await response.text()).toBe("Export failed");
});
