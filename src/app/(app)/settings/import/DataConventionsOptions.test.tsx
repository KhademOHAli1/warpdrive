// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useReducer } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { Locale } from "@/features/i18n/registry";
import {
  buildColumnMapping,
  initialWizardState,
  wizardReducer,
} from "@/features/import/wizardState";
import { MapStep } from "./MapStep";

vi.mock("@/features/i18n/actions", () => ({
  saveLocalePreferencesAction: () => Promise.resolve({ ok: true }),
}));
afterEach(cleanup);
function Harness({ locale }: { locale: Locale }) {
  const [state, dispatch] = useReducer(wizardReducer, {
    ...initialWizardState(),
    target: "activity" as const,
    headers: ["Subject", "Due"],
    columns: {
      Subject: { entity: "activity" as const, field: "subject", isCustom: false, key: "" },
      Due: { entity: "activity" as const, field: "dueAt", isCustom: false, key: "" },
    },
  });
  return (
    <LocaleProvider locale={locale} calendar="persian" timeZone="Asia/Tehran">
      <MapStep state={state} dispatch={dispatch} defs={[]} busy={false} onContinue={() => {}} />
      <output data-testid="mapping">{JSON.stringify(buildColumnMapping(state).options)}</output>
    </LocaleProvider>
  );
}
it.each([
  [
    "fa",
    "تقویم تاریخ‌های فایل",
    "میلادی",
    "هجری خورشیدی (جلالی)",
    "منطقهٔ زمانی پیش‌فرض تاریخ‌های فایل",
  ],
  [
    "de",
    "Kalender der Quelldatei",
    "Gregorianisch",
    "Persisch (Jalali)",
    "Zeitzone für Angaben ohne UTC-Versatz",
  ],
] as const)(
  "lets %s operators explicitly choose source calendar/zone independently of their interface preferences",
  async (locale, label, gregory, persian, zoneLabel) => {
    const user = userEvent.setup();
    render(<Harness locale={locale} />);
    expect(screen.getByRole("combobox", { name: label })).toHaveTextContent(gregory);
    expect(screen.getByRole("combobox", { name: zoneLabel })).toHaveTextContent("UTC");
    await user.click(screen.getByRole("combobox", { name: label }));
    await user.click(screen.getByRole("option", { name: persian }));
    await user.click(screen.getByRole("combobox", { name: zoneLabel }));
    await user.click(screen.getByRole("option", { name: "Asia/Tehran" }));
    expect(JSON.parse(screen.getByTestId("mapping").textContent ?? "{}")).toMatchObject({
      dateCalendar: "persian",
      dateTimeZone: "Asia/Tehran",
    });
  },
);
