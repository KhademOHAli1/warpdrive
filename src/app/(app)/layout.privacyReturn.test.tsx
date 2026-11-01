import type * as NextNavigation from "next/navigation";
import { redirect } from "next/navigation";
import { NextRequest, NextResponse } from "next/server";
import { isValidElement } from "react";
import { afterEach, beforeEach, expect, type MockInstance, test, vi } from "vitest";
import { db } from "@/db/client";
import { PRIVACY_CASE_PATH_HEADER } from "@/features/privacy/requestPath";
import { proxy } from "@/proxy";

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  pending: vi.fn(),
  preferences: vi.fn(),
  currency: vi.fn(),
  requestHeaders: new Headers(),
  headers: vi.fn(),
  jar: new Map<string, { value: string }>(),
}));
// The real DB module is untouched; only request identity and shell service boundaries are controlled.
vi.mock("@/server/trpc/context", () => ({ createContext: mocks.context }));
vi.mock("@/features/auth/better/sessionPolicy", () => ({ resolveWorkflowSession: mocks.pending }));
vi.mock("@/features/identity/preferencesForActor", () => ({
  getPreferencesForActor: mocks.preferences,
}));
vi.mock("@/features/settings/readBaseCurrency", () => ({ readBaseCurrency: mocks.currency }));
vi.mock("next/headers", () => ({
  headers: mocks.headers,
  cookies: () => Promise.resolve(mocks.jar),
}));
vi.mock("next/navigation", async (importOriginal) => {
  const actual = await importOriginal<typeof NextNavigation>();
  return { ...actual, redirect: vi.fn(actual.redirect) };
});
vi.mock("@/components/shell/ActionErrorProvider", () => ({ ActionErrorProvider: () => null }));
vi.mock("@/components/shell/CsrfRefresher", () => ({ CsrfRefresher: () => null }));
vi.mock("@/components/shell/LeftNav", () => ({ LeftNav: () => null }));
vi.mock("@/components/shell/ReconnectBanner", () => ({ ReconnectBanner: () => null }));
vi.mock("@/components/shell/TopBar", () => ({ TopBar: () => null }));
vi.mock("@/features/activities/followUpAfterDone", () => ({ FollowUpPromptProvider: () => null }));
vi.mock("@/features/currencies/CurrencyProvider", () => ({ CurrencyProvider: () => null }));
vi.mock("@/features/identity/InterfacePrefsProvider", () => ({
  InterfacePrefsProvider: () => null,
}));
vi.mock("@/features/observability/IdentifyUser", () => ({ IdentifyUser: () => null }));
vi.mock("@/features/release/ui/VersionBanner", () => ({ VersionBanner: () => null }));
vi.mock("@/features/search/ui/CommandPalette", () => ({ CommandPalette: () => null }));
vi.mock("@/features/shortcuts/GlobalShortcuts", () => ({ GlobalShortcuts: () => null }));

import AppLayout from "./layout";

const CASE_PATH = "/settings/privacy/requests/a3c8f25e-2b78-4c12-92f7-79c97b7ed913";
const FORGED_PATH = "/settings/privacy/requests/00000000-0000-4000-8000-000000000032";
let nextResponseSpy: MockInstance<typeof NextResponse.next>;

beforeEach(() => {
  vi.clearAllMocks();
  nextResponseSpy = vi.spyOn(NextResponse, "next");
  mocks.requestHeaders = new Headers();
  mocks.jar.clear();
  mocks.headers.mockImplementation(() => Promise.resolve(mocks.requestHeaders));
  mocks.context.mockResolvedValue({ db, actor: null, session: null });
  mocks.pending.mockResolvedValue(null);
  mocks.preferences.mockResolvedValue({ density: "comfortable", ui: { appearance: "day" } });
  mocks.currency.mockResolvedValue("EUR");
});
afterEach(() => vi.restoreAllMocks());

function fromRequest(path: string) {
  const request = new NextRequest(`https://app.example.test${path}`, {
    headers: { [PRIVACY_CASE_PATH_HEADER]: FORGED_PATH, cookie: "session=PRIVATE-cookie" },
  });
  proxy(request);
  mocks.requestHeaders =
    nextResponseSpy.mock.calls.at(-1)?.[0]?.request?.headers ?? request.headers;
}

async function expectDestination(path: string) {
  await expect(AppLayout({ children: "PRIVATE-child" })).rejects.toMatchObject({
    digest: expect.stringContaining("NEXT_REDIRECT;"),
  });
  expect(redirect).toHaveBeenCalledOnce();
  expect(redirect).toHaveBeenCalledWith(path);
  expect(mocks.pending).toHaveBeenCalledWith(db, mocks.requestHeaders, expect.any(AbortSignal), {
    allowPending: true,
  });
  expect(mocks.preferences).not.toHaveBeenCalled();
  expect(mocks.currency).not.toHaveBeenCalled();
}

test.each([
  [false, "/login"],
  [true, "/auth/continue"],
] as const)(
  "preserves a cold own-case destination with pending session %s",
  async (pending, target) => {
    mocks.pending.mockResolvedValueOnce(pending ? { authenticated: true } : null);
    fromRequest(`${CASE_PATH}?summary=PRIVATE-query&next=https://evil.example.test`);
    await expectDestination(`${target}?returnTo=${encodeURIComponent(CASE_PATH)}`);
  },
);

test.each([
  [false, "/login"],
  [true, "/auth/continue"],
] as const)(
  "keeps ordinary navigation unchanged with pending session %s",
  async (pending, target) => {
    mocks.pending.mockResolvedValueOnce(pending ? { authenticated: true } : null);
    fromRequest("/pipeline?PRIVATE-query=1");
    await expectDestination(target);
  },
);

test.each([
  `https://evil.example.test${CASE_PATH}`,
  `${CASE_PATH}?summary=PRIVATE-query`,
  "/settings/privacy/requests/not-an-id",
])("independently rejects malformed internal path metadata %#", async (path) => {
  mocks.requestHeaders.set(PRIVACY_CASE_PATH_HEADER, path);
  await expectDestination("/login");
});

test("an authenticated actor keeps the existing shell without a return-path redirect", async () => {
  const actor = {
    id: "00000000-0000-4000-8000-000000000001",
    type: "regular",
    isActive: true,
    name: "Requester",
    email: "requester@example.test",
    avatarUrl: null,
    flags: new Set(),
    groupIds: new Set(),
  };
  mocks.context.mockResolvedValueOnce({ db, actor, session: null });
  mocks.requestHeaders.set(PRIVACY_CASE_PATH_HEADER, CASE_PATH);
  const tree = await AppLayout({ children: "PRIVATE-child" });
  expect(isValidElement(tree)).toBe(true);
  expect(tree).toMatchObject({ props: { currency: "EUR" } });
  expect(redirect).not.toHaveBeenCalled();
  expect(mocks.pending).not.toHaveBeenCalled();
  expect(mocks.headers).not.toHaveBeenCalled();
  expect(mocks.preferences).toHaveBeenCalledOnce();
  expect(mocks.preferences).toHaveBeenCalledWith(db, actor.id);
  expect(mocks.currency).toHaveBeenCalledWith(db, expect.any(AbortSignal));
});
