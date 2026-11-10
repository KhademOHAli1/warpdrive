import { type ReactNode, useEffect, useLayoutEffect, useState } from "react";
import { vi } from "vitest";
import type { SecurityStatus } from "@/features/auth/better/contracts";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { Locale } from "@/features/i18n/registry";
import { ok } from "@/types/result";
import type { NativeSubjectReviewCardProps } from "../ui/NativeSubjectReviewCard";
import type { ReviewerCaseReferenceEntryProps } from "../ui/ReviewerCaseReferenceEntry";

const mocks = vi.hoisted(() => ({
  child: vi.fn<(props: NativeSubjectReviewCardProps) => ReactNode>(),
  original: vi.fn<(props: NativeSubjectReviewCardProps) => ReactNode>(),
}));

export { mocks };

vi.mock("../ui/NativeSubjectReviewCard", () => ({ NativeSubjectReviewCard: mocks.child }));
vi.mock("../ui/ReviewerCaseCard", () => ({ ReviewerCaseCard: mocks.original }));

export const CASE = "ab4e0aab-2bb3-4ca4-8db5-cff607a0b0b1";
export const NEXT_CASE = "ab4e0aab-2bb3-4ca4-8db5-cff607a0b0b2";
export const REVIEWER = "00000000-0000-4000-8000-000000000001";
export const OTHER = "00000000-0000-4000-8000-000000000002";
export const CHILD_PRIVATE = "SENSITIVE-EXACT-CASE-SOURCE";
export const LATE_PRIVATE = "SENSITIVE-LATE-CASE-SOURCE";
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
    title: "Review a request by reference",
    reference: "Request reference",
    open: "Open source preview",
    invalid: "Enter a valid request reference.",
    verifyEmail: "Verify your email address before reviewing request data.",
  },
  de: {
    title: "Anfrage über Referenz prüfen",
    reference: "Anfragereferenz",
    open: "Quellenvorschau öffnen",
    invalid: "Geben Sie eine gültige Anfragereferenz ein.",
    verifyEmail: "Bestätigen Sie Ihre E-Mail-Adresse, bevor Sie Anfragedaten prüfen.",
  },
  fa: {
    title: "بررسی درخواست با شناسه",
    reference: "شناسهٔ درخواست",
    open: "باز کردن پیش‌نمایش منبع",
    invalid: "شناسهٔ معتبر درخواست را وارد کنید.",
    verifyEmail: "پیش از بررسی داده‌های درخواست، نشانی ایمیل خود را تأیید کنید.",
  },
};
export function entryProps(
  patch: Partial<ReviewerCaseReferenceEntryProps> = {},
): ReviewerCaseReferenceEntryProps {
  return {
    securityStatus: security,
    refreshSecurity: vi
      .fn<ReviewerCaseReferenceEntryProps["refreshSecurity"]>()
      .mockResolvedValue(ok(security)),
    securityUnavailable: false,
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
export function reset() {
  vi.resetAllMocks();
  mocks.original.mockImplementation(() => <div data-testid="original-case-context" />);
  mocks.child.mockImplementation(() => (
    <div data-testid="exact-case-preview">
      <p>{CHILD_PRIVATE}</p>
    </div>
  ));
}
export function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
function LatePreview({ ready }: { ready: Promise<void> }) {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let mounted = true;
    void ready.then(() => {
      if (mounted) setLoaded(true);
    });
    return () => {
      mounted = false;
    };
  }, [ready]);
  return (
    <div data-testid="exact-case-preview">{loaded ? LATE_PRIVATE : "Synthetic child waiting"}</div>
  );
}
export function installLateChild(ready: Promise<void>) {
  mocks.child.mockImplementation(() => <LatePreview ready={ready} />);
}
