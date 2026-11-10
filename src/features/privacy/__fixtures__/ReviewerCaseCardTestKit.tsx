import { type ReactNode, useLayoutEffect } from "react";
import { vi } from "vitest";
import type { SecurityStatus } from "@/features/auth/better/contracts";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { resolveLocalePreferences } from "@/features/i18n/preferences";
import type { Locale } from "@/features/i18n/registry";
import { formatDateTime, formatNumber } from "@/lib/localeFormatting";
import { ok } from "@/types/result";
import type { PrivacyReviewerCase } from "../reviewerCaseTypes";
import type { NativeSubjectReviewCardProps } from "../ui/nativeSubjectReviewCardModel";

const mocks = vi.hoisted(() => ({ read: vi.fn() }));

export { mocks };

vi.mock("../reviewerActions", () => ({ readPrivacyReviewerCaseAction: mocks.read }));
vi.mock("@/features/i18n/actions", () => ({ saveLocalePreferencesAction: vi.fn() }));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));
export const REVIEWER = "00000000-0000-4000-8000-000000000001";
export const OTHER = "00000000-0000-4000-8000-000000000002";
export const CASE = "00000000-0000-4000-8000-000000000031";
export const NEXT_CASE = "00000000-0000-4000-8000-000000000032";
export const ORIGINAL_ID = "00000000-0000-4000-8000-000000000041";
export const RECIPIENT_ID = "00000000-0000-4000-8000-000000000042";
export const SUMMARY = "ORIGINAL-REQUEST-SUMMARY";
export const ORIGINAL_SUBJECT = "ORIGINAL-EXTERNAL-SUBJECT";
export const ORIGINAL_EMAIL = "original-private@example.test";
export const RECEIVED = "2026-03-21T00:30:00.000Z";
export const DUE = "2026-04-22T10:45:00.000Z";
export const security: SecurityStatus = {
  authenticated: true,
  user: { id: REVIEWER, name: "Reviewer", email: "reviewer@example.test", isAdmin: false },
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
export function row(): PrivacyReviewerCase {
  return {
    formatVersion: 1,
    case: {
      id: CASE,
      kind: "closure",
      status: "under_review",
      version: 3,
      receivedAt: RECEIVED,
      dueAt: DUE,
      policyVersion: 8,
    },
    request: {
      kind: "access",
      locale: "fa",
      summary: SUMMARY,
      subject: { kind: "external", description: ORIGINAL_SUBJECT },
      recipient: { channel: "email", address: ORIGINAL_EMAIL },
    },
    identity: { state: "current" },
    policy: { activeVersion: 1, generation: 4 },
  };
}
export const labels = {
  en: {
    title: "Request context for reviewers",
    load: "Load request context",
    refresh: "Refresh request context",
    original: "Original request",
    originalNotice:
      "These are the original submitted details. Later identity review does not replace them.",
    currentKind: "Current request type",
    currentStatus: "Current status",
    revision: "Request revision",
    originalKind: "Original request type",
    originalLocale: "Original request language",
    summary: "Original summary",
    subject: "Original subject",
    recipient: "Original recipient",
    casePolicy: "Case policy version",
    activePolicy: "Active policy version",
    identity: "Identity review",
    current: "Identity binding is current",
    reviewRequired: "Identity review is required",
    received: "Received",
    due: "Response due",
    absent: "Not recorded",
    unconfigured: "Not configured",
    closure: "Account closure",
    access: "Access request",
    underReview: "Under review",
    persian: "Persian",
    external: "External subject",
    contact: "Contact",
    user: "User",
    email: "Email",
    inApp: "In-app recipient",
    assisted: "Operator-assisted recipient",
    unavailable: "The request context is unavailable. Load it again.",
    fresh: "Confirm your identity before loading request details.",
    verifyEmail: "Verify your email address before reviewing request data.",
  },
  de: {
    title: "Anfragekontext für die Prüfung",
    load: "Anfragekontext laden",
    refresh: "Anfragekontext aktualisieren",
    original: "Ursprüngliche Anfrage",
    originalNotice:
      "Dies sind die ursprünglich eingereichten Angaben. Eine spätere Identitätsprüfung ersetzt sie nicht.",
    currentKind: "Aktuelle Anfrageart",
    currentStatus: "Aktueller Status",
    revision: "Anfragerevision",
    originalKind: "Ursprüngliche Anfrageart",
    originalLocale: "Ursprüngliche Anfragesprache",
    summary: "Ursprüngliche Zusammenfassung",
    subject: "Ursprüngliche betroffene Person",
    recipient: "Ursprünglicher Empfänger",
    casePolicy: "Richtlinienversion der Anfrage",
    activePolicy: "Aktive Richtlinienversion",
    identity: "Identitätsprüfung",
    current: "Identitätszuordnung ist aktuell",
    reviewRequired: "Identitätsprüfung erforderlich",
    received: "Eingegangen",
    due: "Antwort fällig",
    absent: "Nicht erfasst",
    unconfigured: "Nicht konfiguriert",
    closure: "Kontoschließung",
    access: "Auskunftsanfrage",
    underReview: "In Prüfung",
    persian: "Persisch",
    external: "Externe betroffene Person",
    contact: "Kontakt",
    user: "Benutzerkonto",
    email: "E-Mail",
    inApp: "Empfänger im System",
    assisted: "Manuell betreuter Empfänger",
    unavailable: "Der Anfragekontext ist nicht verfügbar. Laden Sie ihn erneut.",
    fresh: "Bestätigen Sie Ihre Identität, bevor Sie Anfragedetails laden.",
    verifyEmail: "Bestätigen Sie Ihre E-Mail-Adresse, bevor Sie Anfragedaten prüfen.",
  },
  fa: {
    title: "اطلاعات درخواست برای بررسی‌کننده",
    load: "بارگیری اطلاعات درخواست",
    refresh: "به‌روزرسانی اطلاعات درخواست",
    original: "درخواست اولیه",
    originalNotice:
      "این‌ها اطلاعات ثبت‌شده در درخواست اولیه‌اند. بررسی بعدی هویت جایگزین این اطلاعات نمی‌شود.",
    currentKind: "نوع کنونی درخواست",
    currentStatus: "وضعیت کنونی",
    revision: "نسخهٔ درخواست",
    originalKind: "نوع درخواست اولیه",
    originalLocale: "زبان درخواست اولیه",
    summary: "شرح اولیه",
    subject: "فرد موضوع درخواست اولیه",
    recipient: "گیرندهٔ اولیه",
    casePolicy: "نسخهٔ سیاست درخواست",
    activePolicy: "نسخهٔ سیاست فعال",
    identity: "بررسی هویت",
    current: "تطبیق هویت به‌روز است",
    reviewRequired: "بررسی هویت لازم است",
    received: "زمان دریافت",
    due: "موعد پاسخ",
    absent: "ثبت نشده",
    unconfigured: "پیکربندی نشده",
    closure: "بستن حساب",
    access: "درخواست دسترسی",
    underReview: "در حال بررسی",
    persian: "فارسی",
    external: "فرد خارج از سامانه",
    contact: "مخاطب",
    user: "حساب کاربری",
    email: "ایمیل",
    inApp: "گیرنده در سامانه",
    assisted: "گیرنده با هماهنگی مسئول",
    unavailable: "اطلاعات درخواست در دسترس نیست. دوباره آن را بارگیری کنید.",
    fresh: "پیش از بارگیری جزئیات درخواست، هویت خود را تأیید کنید.",
    verifyEmail: "پیش از بررسی داده‌های درخواست، نشانی ایمیل خود را تأیید کنید.",
  },
};
export function cardProps(
  patch: Partial<NativeSubjectReviewCardProps> = {},
): NativeSubjectReviewCardProps {
  return {
    caseId: CASE,
    securityStatus: security,
    refreshSecurity: vi
      .fn<NativeSubjectReviewCardProps["refreshSecurity"]>()
      .mockResolvedValue(ok(security)),
    ...patch,
  };
}
function CommitProbe({
  children,
  observe,
}: {
  children: ReactNode;
  observe?: (text: string) => void;
}) {
  useLayoutEffect(() => {
    observe?.(document.body.textContent);
  });
  return children;
}
export function wrap(children: ReactNode, locale: Locale = "en", observe?: (text: string) => void) {
  return (
    <LocaleProvider locale={locale} timeZone="UTC">
      <CommitProbe observe={observe}>{children}</CommitProbe>
    </LocaleProvider>
  );
}
export const dateLabel = (value: string, locale: Locale) =>
  formatDateTime(value, resolveLocalePreferences({ locale, timeZone: "UTC" }));
export const numberLabel = (value: number, locale: Locale) =>
  formatNumber(value, resolveLocalePreferences({ locale, timeZone: "UTC" }));
export function reset() {
  vi.resetAllMocks();
  mocks.read.mockResolvedValue(ok(row()));
}
export function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
