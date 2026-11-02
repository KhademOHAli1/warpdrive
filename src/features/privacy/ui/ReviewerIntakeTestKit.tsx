import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";
import type { SecurityStatus } from "@/features/auth/better/contracts";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { Locale } from "@/features/i18n/registry";
import { ok } from "@/types/result";
import { ReviewerIntakeCard, type ReviewerIntakeCardProps } from "./ReviewerIntakeCard";

const mocks = vi.hoisted(() => ({ list: vi.fn(), claim: vi.fn() }));

export { mocks };

vi.mock("../reviewerActions", () => ({
  listPrivacyIntakeQueueAction: mocks.list,
  claimPrivacyCaseAction: mocks.claim,
}));
vi.mock("@/features/i18n/actions", () => ({ saveLocalePreferencesAction: vi.fn() }));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));

export const REVIEWER_ID = "00000000-0000-4000-8000-000000000001";
export const OTHER_ID = "00000000-0000-4000-8000-000000000002";
export const CASE_ID = "00000000-0000-4000-8000-000000000031";
export const PRIVATE = "PRIVATE-REVIEWER-ROW-SENTINEL";
export const security: SecurityStatus = {
  authenticated: true,
  user: { id: REVIEWER_ID, name: "Reviewer", email: "reviewer@example.test", isAdmin: false },
  emailVerified: true,
  hasPassword: true,
  twoFactorEnabled: false,
  needsMfa: false,
  needsEnrollment: false,
  fresh: true,
  authMethod: "password",
  policy: { requireMfaForAll: false, idleMinutes: 30, absoluteHours: 12, freshMinutes: 5 },
  accounts: [],
  passkeys: [],
  sessions: [],
  recoveryCodesAvailable: false,
  audit: [],
};
export function row(version = 7) {
  return {
    id: CASE_ID,
    kind: "access",
    status: "received",
    version,
    receivedAt: new Date("2026-03-21T00:30:00Z"),
    dueAt: null,
    metadataEnc: PRIVATE,
  };
}
export function queue(version = 7) {
  return { items: [row(version)], nextAfterId: null, snapshot: "live_unassigned" as const };
}
export const labels = {
  en: { title: "Requests awaiting a reviewer", load: "Load intake queue", claim: "Take this case" },
  de: {
    title: "Anfragen ohne zuständige Person",
    load: "Neue Anfragen laden",
    claim: "Prüfung übernehmen",
  },
  fa: {
    title: "درخواست‌های در انتظار بررسی",
    load: "بارگیری درخواست‌های تازه",
    claim: "پذیرش بررسی درخواست",
  },
};
export function show(locale: Locale = "en", status = security) {
  const refreshSecurity = vi
    .fn<ReviewerIntakeCardProps["refreshSecurity"]>()
    .mockResolvedValue(ok(status));
  const element = (next = status, unavailable = false) => (
    <LocaleProvider locale={locale} timeZone="UTC">
      <ReviewerIntakeCard
        securityStatus={next}
        refreshSecurity={refreshSecurity}
        securityUnavailable={unavailable}
      />
    </LocaleProvider>
  );
  const view = render(element());
  return {
    refreshSecurity,
    view,
    rerender: (next = status, unavailable = false) => view.rerender(element(next, unavailable)),
  };
}
export async function load(locale: Locale = "en") {
  fireEvent.click(screen.getByRole("button", { name: labels[locale].load }));
  await screen.findByText(CASE_ID, {}, { timeout: 1000 });
}
export function reset() {
  vi.resetAllMocks();
  mocks.list.mockResolvedValue(ok(queue()));
  mocks.claim.mockResolvedValue(ok({ id: CASE_ID, version: 8, status: "received" }));
}
export function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}
