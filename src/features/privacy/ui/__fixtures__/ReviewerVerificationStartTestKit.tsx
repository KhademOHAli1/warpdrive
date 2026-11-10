import assert from "node:assert/strict";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, vi } from "vitest";
import type { SecurityStatus } from "@/features/auth/better/contracts";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { Locale } from "@/features/i18n/registry";
import type { NumberingSystem } from "@/lib/numberingSystem";
import { ok, type Result } from "@/types/result";
import { privacyReviewerMessagesForLocale } from "../../privacyReviewerMessages";
import type {
  claimPrivacyCaseAction,
  listPrivacyIntakeQueueAction,
  transitionPrivacyCaseAction,
} from "../../reviewerActions";
import type { ReviewerIntakeCardProps } from "../reviewerIntakeModel";

type Queue = Extract<
  Awaited<ReturnType<typeof listPrivacyIntakeQueueAction>>,
  { ok: true }
>["value"];
type Claim = Extract<Awaited<ReturnType<typeof claimPrivacyCaseAction>>, { ok: true }>["value"];
type Transition = Extract<
  Awaited<ReturnType<typeof transitionPrivacyCaseAction>>,
  { ok: true }
>["value"];
type TransitionBoundary = (
  ...args: Parameters<typeof transitionPrivacyCaseAction>
) => Promise<Result<Transition, unknown>>;
const mocks = vi.hoisted(() => ({
  list: vi.fn<typeof listPrivacyIntakeQueueAction>(),
  claim: vi.fn<typeof claimPrivacyCaseAction>(),
  transition: vi.fn<TransitionBoundary>(),
}));

export { mocks };

vi.mock("../../reviewerActions", () => ({
  listPrivacyIntakeQueueAction: mocks.list,
  claimPrivacyCaseAction: mocks.claim,
  transitionPrivacyCaseAction: mocks.transition,
}));
vi.mock("@/features/i18n/actions", () => ({ saveLocalePreferencesAction: vi.fn() }));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));

// Only framework/action transport is stubbed. No tested component, hook, DB or native service is mocked.
export const USER = "00000000-0000-4000-8000-000000000001";
export const OTHER = "00000000-0000-4000-8000-000000000002";
export const CASE = "00000000-0000-4000-8000-000000000031";
export const OTHER_CASE = "00000000-0000-4000-8000-000000000099";
export const PRIVATE = "PRIVATE-VERIFICATION-TRANSPORT-SENTINEL";
export const security: SecurityStatus = {
  authenticated: true,
  user: { id: USER, name: "Synthetic reviewer", email: "reviewer@example.test", isAdmin: false },
  emailVerified: true,
  fresh: true,
  hasPassword: true,
  twoFactorEnabled: false,
  needsMfa: false,
  needsEnrollment: false,
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
    title: "Identity verification",
    start: "Start identity verification",
    retry: "Retry this verification step",
    clear: "Clear saved retry",
    warning: "Starting identity verification clears any earlier confirmation. No message is sent.",
    uncertain: "The result is not confirmed. Retry the same verification step.",
    recorded: "Verification step receipt recorded.",
    historical:
      "This is a historical command receipt. It does not confirm current ownership or request status.",
    clearHelp:
      "This clears only local retry details. It does not undo a status change already recorded by the server.",
    stale:
      "The request changed or this step is unavailable. The saved result is unresolved; ask the workspace operator to check the request before starting another step.",
  },
  de: {
    title: "Identitätsprüfung",
    start: "Identitätsprüfung starten",
    retry: "Diesen Prüfschritt erneut versuchen",
    clear: "Gespeicherte Wiederholungsdaten löschen",
    warning:
      "Beim Start der Identitätsprüfung wird eine frühere Bestätigung aufgehoben. Es wird keine Nachricht gesendet.",
    uncertain: "Das Ergebnis ist nicht bestätigt. Versuchen Sie denselben Prüfschritt erneut.",
    recorded: "Beleg für den Prüfschritt erfasst.",
    historical:
      "Dieser Beleg dokumentiert den damaligen Vorgang. Er bestätigt weder die aktuelle Zuständigkeit noch den aktuellen Anfragestatus.",
    clearHelp:
      "Hierdurch werden nur die lokalen Wiederholungsdaten gelöscht. Eine bereits vom Server erfasste Statusänderung wird nicht rückgängig gemacht.",
  },
  fa: {
    title: "بررسی هویت",
    start: "شروع بررسی هویت",
    retry: "تلاش دوباره برای همین مرحلهٔ بررسی هویت",
    clear: "پاک‌کردن اطلاعات تلاش دوباره",
    warning: "با شروع بررسی هویت، تأیید قبلی کنار گذاشته می‌شود. هیچ پیامی ارسال نمی‌شود.",
    uncertain: "نتیجه تأیید نشده است. همین مرحلهٔ بررسی هویت را دوباره انجام دهید.",
    recorded: "رسید مرحلهٔ بررسی هویت ثبت شد.",
    historical:
      "این رسید فقط ثبت فرمان را نشان می‌دهد و مالکیت یا وضعیت کنونی درخواست را تأیید نمی‌کند.",
    clearHelp:
      "با این کار فقط اطلاعات محلیِ تلاش دوباره پاک می‌شود. تغییر وضعیتی که سرور قبلاً ثبت کرده است لغو نمی‌شود.",
  },
};
export const claimReceipt = (patch: Partial<Claim> = {}): Claim => ({
  id: CASE,
  version: 8,
  status: "received",
  ...patch,
});
export const transitionReceipt = (patch: Partial<Transition> = {}): Transition => ({
  id: CASE,
  kind: "access",
  status: "verification_needed",
  version: 9,
  receivedAt: new Date("2026-03-21T00:30:00Z"),
  ...patch,
});
export const queue = (version = 7, status = "received", id = CASE): Queue => ({
  items: [
    {
      id,
      kind: "access",
      status,
      version,
      receivedAt: new Date("2026-03-21T00:30:00Z"),
      dueAt: null,
    },
  ],
  nextAfterId: null,
  snapshot: "live_unassigned",
});
export function resetVerificationStart() {
  vi.resetAllMocks();
  mocks.list.mockResolvedValue(ok(queue()));
  mocks.claim.mockResolvedValue(ok(claimReceipt()));
  mocks.transition.mockResolvedValue(ok(transitionReceipt()));
}
export function mountReviewer(
  card: (props: ReviewerIntakeCardProps) => ReactNode,
  options: { locale?: Locale; status?: SecurityStatus; numberingSystem?: NumberingSystem } = {},
) {
  const initial = options.status ?? security;
  const refresh = vi
    .fn<ReviewerIntakeCardProps["refreshSecurity"]>()
    .mockResolvedValue(ok(security));
  const element = (status: SecurityStatus, unavailable: boolean, recheck = refresh) => (
    <LocaleProvider
      locale={options.locale ?? "en"}
      calendar="gregory"
      timeZone="UTC"
      numberingSystem={options.numberingSystem}
    >
      {card({
        securityStatus: status,
        refreshSecurity: recheck,
        securityUnavailable: unavailable,
      })}
    </LocaleProvider>
  );
  const view = render(element(initial, false));
  return {
    view,
    refresh,
    rerender: (status = initial, unavailable = false, recheck = refresh) =>
      view.rerender(element(status, unavailable, recheck)),
  };
}
export async function press(name: string) {
  await act(() => {
    fireEvent.click(screen.getByRole("button", { name }));
    return Promise.resolve();
  });
}
export async function loadAndClaim(locale: Locale = "en") {
  const L = privacyReviewerMessagesForLocale(locale);
  await press(L.load);
  expect(mocks.list).toHaveBeenCalledTimes(1);
  expect(screen.getByText(CASE)).toBeInTheDocument();
  await press(L.claim);
  expect(mocks.claim).toHaveBeenCalledTimes(1);
  expect(screen.getByText(L.recorded)).toBeInTheDocument();
}
export async function uncertainIntent() {
  await press(labels.en.start);
  expect(mocks.transition).toHaveBeenCalledTimes(1);
  const intent = mocks.transition.mock.calls[0]?.[1];
  assert(
    typeof intent === "object" && intent !== null,
    "Expected an actual sent transition command",
  );
  expect(Object.isFrozen(intent)).toBe(true);
  expect(screen.getByRole("button", { name: labels.en.retry })).toBeEnabled();
  return intent;
}
export function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Value>((complete, fail) => {
    resolve = complete;
    reject = fail;
  });
  return { promise, resolve, reject };
}
export async function settle<Value>(pending: ReturnType<typeof deferred<Value>>, value: Value) {
  await act(async () => {
    pending.resolve(value);
    await pending.promise;
  });
}
export const losses = [
  { name: "email", status: { ...security, emailVerified: false }, unavailable: false },
  { name: "raw freshness", status: { ...security, fresh: false }, unavailable: false },
  { name: "MFA", status: { ...security, needsMfa: true }, unavailable: false },
  { name: "enrollment", status: { ...security, needsEnrollment: true }, unavailable: false },
  { name: "unavailable", status: security, unavailable: true },
] as const;
