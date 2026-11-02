// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";

afterEach(() => {
  cleanup();
  forgetBoardView();
  vi.clearAllMocks();
});

const { refresh, reportError, archiveDealsAction, invalidateQueries } = vi.hoisted(() => ({
  refresh: vi.fn(),
  reportError: vi.fn(),
  archiveDealsAction: vi.fn(),
  invalidateQueries: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: (opts: { initialData: unknown }) => ({ data: opts.initialData }),
  useQueryClient: () => ({ invalidateQueries }),
  keepPreviousData: Symbol("keepPreviousData"),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
  usePathname: () => "/pipeline/p/list",
}));
vi.mock("@/features/deal-workspace/DealActionErrorProvider", () => ({
  useDealActionError: () => reportError,
  DealActionErrorProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    useUtils: () => ({ client: {} }),
    identity: { assignableUsers: { useQuery: () => ({ data: [] }) } },
    labels: {
      listByTarget: { useQuery: () => ({ data: [] }) },
      appliedNames: { useQuery: () => ({ data: [] }) },
    },
  },
}));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));
vi.mock("@/features/identity/preferencesActions", () => ({
  setColumnViewAction: vi.fn(),
  setBoardViewAction: () => Promise.resolve({ ok: true }),
}));
vi.mock("./archiveActions", () => ({
  archiveDealAction: vi.fn(),
  archiveDealsAction,
}));

let listProps: DealListProps | undefined;
vi.mock("./DealList", () => ({
  DealList: (p: DealListProps) => {
    listProps = p;
    return <div data-testid="deal-list" />;
  },
}));
vi.mock("./BoardToolbar", () => ({
  BoardToolbar: () => null,
}));
vi.mock("./BoardFilterControl", () => ({ BoardFilterControl: () => null }));
vi.mock("./BoardSortControl", () => ({ BoardSortControl: () => null }));
vi.mock("./NewDealButton", () => ({ NewDealButton: () => null }));

import { forgetBoardView } from "./boardViewMemory";
import type { DealListProps } from "./DealList";
import { DealListClient } from "./DealListClient";
import { DEAL_LIST_QUERY_ROOT } from "./dealListQueryKey";

const expectedWriteVersions = {
  d1: "00000000-0000-4000-8000-000000000001",
  d2: "00000000-0000-4000-8000-000000000002",
};

const row = {
  id: "d1",
  title: "Acme renewal",
  value: "25000.00",
  stageId: "s1",
  boardPosition: "1",
  ownerId: "u1",
  personId: null,
  orgId: null,
  ownerName: "User A",
  orgName: "Acme Inc",
  nextActivityAt: null,
  lastActivityAt: null,
  stageEnteredAt: new Date("2026-06-24T00:00:00Z"),
  writeVersion: "00000000-0000-4000-8000-000000000001",
  updatedAt: "2026-06-24T00:00:00Z",
  customFields: {},
};

const initial = {
  pipelineId: "p1",
  stages: [{ id: "s1", name: "Qualified" }],
  pipelines: [{ id: "p1", name: "Sales", stages: [{ id: "s1", name: "Qualified" }] }],
  rows: [row, { ...row, id: "d2" }],
  total: 2,
  totalValue: "50000.00",
};

describe("DealListClient bulk archive wiring", () => {
  it("calls archiveDealsAction with the selected ids, the archived flag, and the CSRF token", async () => {
    archiveDealsAction.mockResolvedValue({
      ok: true,
      count: 2,
      rows: [
        { dealId: "d1", outcome: "applied" },
        { dealId: "d2", outcome: "applied" },
      ],
    });
    render(<DealListClient initial={initial} />);

    const applied = await listProps?.onBulkArchive?.(["d1", "d2"], expectedWriteVersions);

    expect(archiveDealsAction).toHaveBeenCalledWith(
      { dealIds: ["d1", "d2"], archived: true, expectedWriteVersions },
      "csrf",
    );
    expect(applied).toBe(true);
    expect(refresh).toHaveBeenCalled();
    expect(reportError).not.toHaveBeenCalled();
  });

  it("reports the error id and keeps the selection when the action fails", async () => {
    archiveDealsAction.mockResolvedValue({ ok: false, error: { id: "E_PERM_001" } });
    render(<DealListClient initial={initial} />);

    const applied = await listProps?.onBulkArchive?.(["d1", "d2"], expectedWriteVersions);

    expect(applied).toBe(false);
    expect(reportError).toHaveBeenCalledWith("E_PERM_001");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("reports a partial outcome when fewer deals were archived than were selected", async () => {
    archiveDealsAction.mockResolvedValue({
      ok: true,
      count: 1,
      rows: [
        { dealId: "d1", outcome: "applied" },
        { dealId: "d2", outcome: "conflict" },
      ],
    });
    render(<DealListClient initial={initial} />);

    const applied = await listProps?.onBulkArchive?.(["d1", "d2"], expectedWriteVersions);

    expect(applied).toEqual({ appliedDealIds: ["d1"] });
    expect(reportError).toHaveBeenCalledWith(ERROR_IDS.DEAL_BULK_ARCHIVE_PARTIAL);
    expect(refresh).toHaveBeenCalled();
  });

  it("invalidates the deal-list read so the archived rows leave the table", async () => {
    archiveDealsAction.mockResolvedValue({
      ok: true,
      count: 2,
      rows: [
        { dealId: "d1", outcome: "applied" },
        { dealId: "d2", outcome: "applied" },
      ],
    });
    render(<DealListClient initial={initial} />);

    await listProps?.onBulkArchive?.(["d1", "d2"], expectedWriteVersions);

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: [DEAL_LIST_QUERY_ROOT] });
  });

  it("leaves the cached rows alone when the archive fails", async () => {
    archiveDealsAction.mockResolvedValue({ ok: false, error: { id: "E_PERM_001" } });
    render(<DealListClient initial={initial} />);

    await listProps?.onBulkArchive?.(["d1", "d2"], expectedWriteVersions);

    expect(invalidateQueries).not.toHaveBeenCalled();
  });

  it("passes no bulk archive handler on the archived view", () => {
    render(<DealListClient initial={initial} variant="archived" />);

    expect(listProps?.onBulkArchive).toBeUndefined();
  });
});
