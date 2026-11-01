import { act, fireEvent, render, screen } from "@testing-library/react";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { Locale } from "@/features/i18n/registry";
import type { loadOwnPrivacySecurity } from "./loadOwnPrivacySecurity";
import { labels, PRIVATE, RECEIPT_ID, receipt, status } from "./OwnPrivacyRequestFormTestKit";
import { PersonalPrivacyWorkspace } from "./PersonalPrivacyWorkspace";

export type SecurityResult = Awaited<ReturnType<typeof loadOwnPrivacySecurity>>;
export const workspaceLabels = {
  en: {
    title: "Privacy requests",
    loading: "Checking sign-in status…",
    unavailable: "Sign-in status is unavailable. Try again.",
    retry: "Check again",
    signIn: "Sign in",
    security: "Account security in a new tab",
  },
  de: {
    title: "Datenschutzanfragen",
    loading: "Anmeldestatus wird geprüft…",
    unavailable: "Der Anmeldestatus ist gerade nicht verfügbar. Versuchen Sie es erneut.",
    retry: "Erneut prüfen",
    signIn: "Anmelden",
    security: "Kontosicherheit in neuem Tab",
  },
  fa: {
    title: "درخواست‌های حریم خصوصی",
    loading: "در حال بررسی وضعیت ورود…",
    unavailable: "وضعیت ورود در دسترس نیست. دوباره تلاش کنید.",
    retry: "بررسی دوباره",
    signIn: "ورود به حساب",
    security: "امنیت حساب در زبانه‌ای جدید",
  },
};
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
export function showWorkspace(locale: Locale = "en") {
  return render(
    <LocaleProvider locale={locale} timeZone="UTC">
      <PersonalPrivacyWorkspace />
    </LocaleProvider>,
  );
}
export async function draft() {
  const input = await screen.findByLabelText(labels.en.summary, {}, { timeout: 1000 });
  fireEvent.change(input, { target: { value: PRIVATE } });
  return input;
}
export function focusWorkspace() {
  fireEvent(window, new Event("focus"));
}
export { labels, PRIVATE, RECEIPT_ID, receipt, status };
