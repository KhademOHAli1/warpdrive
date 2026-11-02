import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";
import type { SecurityStatus } from "@/features/auth/better/contracts";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { Locale } from "@/features/i18n/registry";
import { ok } from "@/types/result";
import { OwnPrivacyRequestForm } from "./OwnPrivacyRequestForm";

const PRIVATE = "PRIVATE-درخواست من";
const RECEIPT_ID = "00000000-0000-4000-8000-000000000011";
const receipt = {
  id: RECEIPT_ID,
  kind: "access",
  status: "received",
  version: 1,
  receivedAt: new Date("2026-03-21T00:30:00Z"),
};
const status: SecurityStatus = {
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
  fresh: false,
  authMethod: "password",
  policy: { requireMfaForAll: false, idleMinutes: 30, absoluteHours: 12, freshMinutes: 5 },
  accounts: [],
  passkeys: [],
  sessions: [],
  recoveryCodesAvailable: false,
  audit: [],
};
const labels = {
  en: {
    title: "Request about my data",
    kind: "Request type",
    summary: "What would you like us to review?",
    submit: "Send request",
    received: "Request received",
    retry: "Retry this request",
  },
  de: {
    title: "Anfrage zu meinen Daten",
    kind: "Art der Anfrage",
    summary: "Was sollen wir prüfen?",
    submit: "Anfrage senden",
    received: "Anfrage eingegangen",
    retry: "Diese Anfrage erneut senden",
  },
  fa: {
    title: "درخواست درباره داده‌های من",
    kind: "نوع درخواست",
    summary: "چه موضوعی را بررسی کنیم؟",
    submit: "ارسال درخواست",
    received: "درخواست دریافت شد",
    retry: "تلاش دوباره برای همین درخواست",
  },
};
function show(locale: Locale = "en") {
  const refreshSecurity = vi.fn().mockResolvedValue(ok({ ...status, fresh: true }));
  const onReceived = vi.fn();
  const view = render(
    <LocaleProvider locale={locale} timeZone="UTC">
      <OwnPrivacyRequestForm
        securityStatus={status}
        refreshSecurity={refreshSecurity}
        onReceived={onReceived}
      />
    </LocaleProvider>,
  );
  return { refreshSecurity, onReceived, view };
}
function fill(locale: Locale = "en") {
  fireEvent.change(screen.getByLabelText(labels[locale].summary), { target: { value: PRIVATE } });
}
function send(locale: Locale = "en") {
  fireEvent.click(screen.getByRole("button", { name: labels[locale].submit }));
}

export { fill, labels, OwnPrivacyRequestForm, PRIVATE, RECEIPT_ID, receipt, send, show, status };
