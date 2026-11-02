import { vi } from "vitest";
import type { CalendarAccountSummary } from "./accounts";
import type { GoogleCalendarCatalog, GoogleCalendarCatalogEntry } from "./catalogContracts";

export const accountId = "264ce746-e40a-46f9-a963-b3cfa71b4874";
export const entryId = "cf30b4ee-97a1-4469-a892-e057354beaf9";
export const entryName = "Team / تیم";
export const account: CalendarAccountSummary = {
  id: accountId,
  provider: "google",
  emailAddress: "owner@example.invalid",
  status: "connected",
  scopes: [],
  version: 1,
  connectedAt: "2030-04-03T09:00:00.000Z",
  disconnectedAt: null,
};
export const entry: GoogleCalendarCatalogEntry = {
  id: entryId,
  calendarId: "team/a?b@example.invalid",
  name: entryName,
  timeZone: "Asia/Tehran",
  accessRole: "writer",
  hidden: false,
  deleted: false,
  available: true,
  supportsMeet: true,
};
export function receipt(selected = true, version = 1) {
  return {
    bindingId: "stable-binding",
    localCalendarId: "dedicated-provider-calendar",
    version,
    selected,
  };
}
export function catalog(): GoogleCalendarCatalog {
  return {
    accountId,
    revision: 7,
    status: "ready",
    calendars: [{ ...entry }],
    discoveredAt: "2030-04-03T09:00:00.000Z",
  };
}
export const ui = {
  configured: true,
  accounts: [] as CalendarAccountSummary[],
  catalog: catalog(),
  queryError: false,
  reads: [] as Array<{ accountId: string; enabled: boolean }>,
};
export const api = {
  discover: vi.fn(),
  select: vi.fn(),
  disconnect: vi.fn(),
  refetchCatalog:
    vi.fn<(accountId: string) => Promise<{ data: GoogleCalendarCatalog; isError: boolean }>>(),
  refetchAccounts: vi.fn(),
  invalidate: vi.fn(),
  routerRefresh: vi.fn(),
};
export function patchEntry(patch: Partial<GoogleCalendarCatalogEntry>, index = 0): void {
  const calendars = [...ui.catalog.calendars];
  calendars[index] = { ...entry, ...calendars[index], ...patch };
  ui.catalog = { ...ui.catalog, calendars };
}
export function patchAccount(patch: Partial<CalendarAccountSummary>): void {
  ui.accounts[0] = { ...account, ...ui.accounts[0], ...patch };
}
function exposedCatalog(): GoogleCalendarCatalog {
  return ui.accounts.find((row) => row.id === accountId)?.status === "connected"
    ? ui.catalog
    : { ...ui.catalog, status: "unavailable", calendars: [], discoveredAt: null };
}
interface Selection {
  accountId: string;
  calendarId: string;
  selected: boolean;
  expectedCatalogRevision: number;
  expectedBindingVersion: number | null;
}
export function commitSelection(selected: boolean, version: number) {
  const saved = receipt(selected, version);
  ui.catalog = {
    ...ui.catalog,
    calendars: ui.catalog.calendars.map((row) =>
      row.id === entryId ? { ...row, selection: saved } : row,
    ),
  };
  return { ok: true as const, data: saved };
}
export function resetUi(): void {
  ui.configured = true;
  ui.accounts = [{ ...account }];
  ui.catalog = catalog();
  ui.queryError = false;
  ui.reads = [];
  api.discover.mockResolvedValue({ ok: true, data: ui.catalog });
  api.select.mockImplementation((input: Selection) =>
    Promise.resolve(commitSelection(input.selected, (input.expectedBindingVersion ?? 0) + 1)),
  );
  api.disconnect.mockResolvedValue({ ok: true });
  api.refetchCatalog.mockImplementation(() =>
    Promise.resolve({ data: exposedCatalog(), isError: ui.queryError }),
  );
  api.refetchAccounts.mockResolvedValue({});
  api.invalidate.mockResolvedValue(undefined);
}
export function queryCatalog(input: { accountId: string }, options?: { enabled?: boolean }) {
  ui.reads.push({ accountId: input.accountId, enabled: options?.enabled !== false });
  return {
    data: ui.catalog,
    isError: ui.queryError,
    isPending: false,
    isLoading: false,
    isFetchedAfterMount: true,
    refetch: () => api.refetchCatalog(input.accountId),
  };
}
export function deferred<T>() {
  let finish: (value: T) => void = () => undefined;
  let fail: (reason: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolve, reject) => {
    finish = resolve;
    fail = reject;
  });
  return {
    promise,
    resolve: (value: T) => finish(value),
    reject: (reason: unknown) => fail(reason),
  };
}
