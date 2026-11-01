import { act, fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";
import type { SecurityStatus } from "@/features/auth/better/contracts";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { Locale } from "@/features/i18n/registry";
import { ok } from "@/types/result";
import type { readOwnPrivacyRequestAction } from "../../requestActions";
import { OwnPrivacyCaseStatus } from "../OwnPrivacyCaseStatus";

const mocks = vi.hoisted(() => ({ read: vi.fn(), verify: vi.fn(), workflow: vi.fn() }));

export { mocks };

vi.mock("../../requestActions", () => ({
  readOwnPrivacyRequestAction: mocks.read,
  verifyOwnPrivacyRequestAction: mocks.verify,
}));
vi.mock("@/features/i18n/actions", () => ({ saveLocalePreferencesAction: vi.fn() }));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));
vi.mock("@/features/auth/ui/workflowRequest", () => ({ workflowAction: mocks.workflow }));
vi.mock("@/features/auth/ui/useAccountStatus", () => ({
  useAuthProviders: () => ({ config: { providers: [], emailPassword: true, passkeys: false } }),
}));

export const CASE_ID = "00000000-0000-4000-8000-000000000031";
export const OTHER_CASE_ID = "00000000-0000-4000-8000-000000000032";
type OwnCase = Extract<
  Awaited<ReturnType<typeof readOwnPrivacyRequestAction>>,
  { ok: true }
>["value"];
export const currentCase: OwnCase = {
  id: CASE_ID,
  kind: "access",
  status: "received",
  version: 3,
  receivedAt: new Date("2026-03-21T00:30:00Z"),
  dueAt: null,
};
export const security: SecurityStatus = {
  authenticated: true,
  user: {
    id: "00000000-0000-4000-8000-000000000001",
    name: "Requester",
    email: "requester@example.test",
    isAdmin: false,
  },
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
export const labels = {
  en: {
    title: "My request status",
    loading: "Checking request status…",
    received: "Received",
    kind: "Access to my data",
    noDeadline: "No response deadline recorded",
    unavailable: "This request is unavailable.",
    failed: "Request status could not be loaded. Try again.",
    refresh: "Refresh request status",
    confirm: "Confirm this request concerns my own account",
    retry: "Retry this confirmation",
    recorded:
      "Your own-account confirmation was recorded. This does not approve a response or data change.",
  },
  de: {
    title: "Status meiner Anfrage",
    loading: "Anfragestatus wird geprüft…",
    received: "Eingegangen",
    kind: "Auskunft über meine Daten",
    noDeadline: "Noch keine Antwortfrist erfasst",
    unavailable: "Diese Anfrage ist nicht verfügbar.",
    failed: "Der Anfragestatus konnte nicht geladen werden. Versuchen Sie es erneut.",
    refresh: "Anfragestatus aktualisieren",
    confirm: "Bestätigen, dass die Anfrage mein eigenes Konto betrifft",
    retry: "Diese Bestätigung erneut senden",
    recorded:
      "Ihre Bestätigung zum eigenen Konto wurde erfasst. Damit wird keine Antwort oder Datenänderung genehmigt.",
  },
  fa: {
    title: "وضعیت درخواست من",
    loading: "در حال بررسی وضعیت درخواست…",
    received: "دریافت شده",
    kind: "دسترسی به داده‌های من",
    noDeadline: "هنوز مهلتی برای پاسخ ثبت نشده است",
    unavailable: "این درخواست در دسترس نیست.",
    failed: "وضعیت درخواست بارگیری نشد. دوباره تلاش کنید.",
    refresh: "به‌روزرسانی وضعیت درخواست",
    confirm: "تأیید می‌کنم این درخواست درباره حساب خودم است",
    retry: "تلاش دوباره برای همین تأیید",
    recorded:
      "تأیید شما درباره حساب خودتان ثبت شد. این کار به معنی تأیید پاسخ یا تغییر داده‌ها نیست.",
  },
};
export function showCase(locale: Locale = "en", status = security, caseId = CASE_ID) {
  const refreshSecurity = vi.fn().mockResolvedValue(ok(status));
  const element = (next = status, id = caseId) => (
    <>
      <button type="button" data-testid="public-security-control">
        PUBLIC-Security-replay-control
      </button>
      <LocaleProvider locale={locale} timeZone="UTC">
        <OwnPrivacyCaseStatus caseId={id} securityStatus={next} refreshSecurity={refreshSecurity} />
      </LocaleProvider>
    </>
  );
  const view = render(element());
  return {
    view,
    refreshSecurity,
    rerender: (next: SecurityStatus, id = caseId) => view.rerender(element(next, id)),
  };
}
export function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}
export async function settle<T>(pending: ReturnType<typeof deferred<T>>, value: T) {
  await act(() => {
    pending.resolve(value);
    return Promise.resolve();
  });
}
export async function loaded(locale: Locale = "en") {
  return screen.findByText(labels[locale].received, {}, { timeout: 1000 });
}
export function refresh(locale: Locale = "en") {
  fireEvent.click(screen.getByRole("button", { name: labels[locale].refresh }));
}
export function confirm(locale: Locale = "en") {
  fireEvent.click(screen.getByRole("button", { name: labels[locale].confirm }));
}
