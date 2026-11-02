import { type ReactNode, useLayoutEffect } from "react";
import { vi } from "vitest";
import type { SecurityStatus } from "@/features/auth/better/contracts";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { resolveLocalePreferences } from "@/features/i18n/preferences";
import type { Locale } from "@/features/i18n/registry";
import { formatDateTime } from "@/lib/localeFormatting";
import { ok } from "@/types/result";
import type { PrivacyNativeSubjectReview } from "../nativeSubjectReviewTypes";
import type { NativeSubjectReviewCardProps } from "./NativeSubjectReviewCard";

const mocks = vi.hoisted(() => ({ load: vi.fn() }));

export { mocks };

vi.mock("../reviewerActions", () => ({ loadPrivacyNativeSubjectReviewAction: mocks.load }));
vi.mock("@/features/i18n/actions", () => ({ saveLocalePreferencesAction: vi.fn() }));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));

export const REVIEWER = "00000000-0000-4000-8000-000000000001";
export const OTHER = "00000000-0000-4000-8000-000000000002";
export const CASE = "00000000-0000-4000-8000-000000000031";
export const NEXT_CASE = "00000000-0000-4000-8000-000000000032";
export const SUBJECT = "00000000-0000-4000-8000-000000000041";
export const NAME = "SENSITIVE-SOURCE-NAME";
export const EMAIL = "source-private@example.test";
export const CREATED = "2026-03-21T00:30:00.000Z";
export const UPDATED = "2026-04-22T10:45:00.000Z";
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
export const labels = {
  en: {
    title: "Verified subject data for review",
    load: "Load verified source",
    refresh: "Refresh source preview",
    notice: "Preliminary source preview. Review is required and coverage is incomplete.",
    person: "Contact",
    user: "User",
    name: "Name",
    firstName: "First name",
    lastName: "Last name",
    emails: "Email addresses",
    phones: "Phone numbers",
    email: "Email address",
    created: "Created",
    updated: "Updated",
    deleted: "Deleted",
    absent: "Not recorded",
    unavailable: "The source preview is unavailable. Load it again.",
    fresh: "Confirm your identity before loading source data.",
    verifyEmail: "Verify your email address before reviewing request data.",
    nextText: "Next text segment",
    previousText: "Previous text segment",
    lastText: "Last text segment",
    segment: "Current text segment",
    nextPoints: "Next contact points",
    previousPoints: "Previous contact points",
  },
  de: {
    title: "Verifizierte Personendaten prüfen",
    load: "Verifizierte Quelldaten laden",
    refresh: "Datenvorschau aktualisieren",
    notice:
      "Vorläufige Datenvorschau. Eine Prüfung ist erforderlich; die Datenabdeckung ist unvollständig.",
    person: "Kontakt",
    user: "Benutzerkonto",
    name: "Vollständiger Name",
    firstName: "Vorname",
    lastName: "Nachname",
    emails: "E-Mail-Adressen",
    phones: "Telefonnummern",
    email: "E-Mail-Adresse",
    created: "Erstellt",
    updated: "Aktualisiert",
    deleted: "Gelöscht",
    absent: "Nicht erfasst",
    unavailable: "Die Datenvorschau ist nicht verfügbar. Laden Sie sie erneut.",
    fresh: "Bestätigen Sie Ihre Identität, bevor Sie Quelldaten laden.",
    verifyEmail: "Bestätigen Sie Ihre E-Mail-Adresse, bevor Sie Anfragedaten prüfen.",
    nextText: "Nächster Textabschnitt",
    previousText: "Vorheriger Textabschnitt",
    lastText: "Letzter Textabschnitt",
    segment: "Aktueller Textabschnitt",
    nextPoints: "Nächste Kontaktdaten",
    previousPoints: "Vorherige Kontaktdaten",
  },
  fa: {
    title: "بررسی داده‌های فرد تأییدشده",
    load: "بارگیری داده‌های تأییدشده",
    refresh: "به‌روزرسانی پیش‌نمایش داده‌ها",
    notice: "این پیش‌نمایش اولیه است؛ بررسی لازم است و پوشش داده‌ها کامل نیست.",
    person: "مخاطب",
    user: "حساب کاربری",
    name: "نام",
    firstName: "نام کوچک",
    lastName: "نام خانوادگی",
    emails: "نشانی‌های ایمیل",
    phones: "شماره‌های تماس",
    email: "نشانی ایمیل",
    created: "زمان ایجاد",
    updated: "زمان به‌روزرسانی",
    deleted: "زمان حذف",
    absent: "ثبت نشده",
    unavailable: "پیش‌نمایش داده‌ها در دسترس نیست. دوباره آن را بارگیری کنید.",
    fresh: "پیش از بارگیری داده‌ها، هویت خود را تأیید کنید.",
    verifyEmail: "پیش از بررسی داده‌های درخواست، نشانی ایمیل خود را تأیید کنید.",
    nextText: "بخش بعدی متن",
    previousText: "بخش قبلی متن",
    lastText: "بخش پایانی متن",
    segment: "بخش کنونی متن",
    nextPoints: "اطلاعات تماس بعدی",
    previousPoints: "اطلاعات تماس قبلی",
  },
};
export function source(kind: "person" | "user" = "person"): PrivacyNativeSubjectReview {
  const common = {
    adapterVersion: 1 as const,
    recordId: SUBJECT,
    sourceFingerprint: "a".repeat(64),
  };
  const record: PrivacyNativeSubjectReview["record"] =
    kind === "person"
      ? {
          ...common,
          store: "persons",
          recordType: "person",
          values: {
            id: SUBJECT,
            name: NAME,
            firstName: "Synthetic",
            lastName: "Subject",
            primaryEmail: EMAIL,
            emails: [{ label: "Work", value: EMAIL, primary: true }],
            phones: [{ label: "Work", value: "+000000000" }],
            createdAt: CREATED,
            updatedAt: UPDATED,
            deletedAt: null,
          },
        }
      : {
          ...common,
          store: "users",
          recordType: "user",
          values: {
            id: SUBJECT,
            name: NAME,
            email: EMAIL,
            createdAt: CREATED,
            updatedAt: UPDATED,
          },
        };
  return {
    formatVersion: 1,
    state: "preliminary",
    complete: false,
    reviewRequired: true,
    binding: {
      caseId: CASE,
      caseVersion: 2,
      subject: { kind: kind === "person" ? "contact" : "user", referenceId: SUBJECT },
      identityScopeVersion: 1,
      recipientVersion: 1,
      verificationVersion: 2,
      policyVersion: 1,
      policyGeneration: 1,
    },
    record,
    coverage: [
      { store: record.store, status: "incomplete", code: "direct_subject_only" },
      { store: "auth_accounts", status: "unsupported", code: "adapter_unavailable" },
    ],
  };
}
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
export function reset() {
  vi.resetAllMocks();
  mocks.load.mockResolvedValue(ok(source()));
}
export function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
