// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { CalendarSystem } from "@/features/i18n/preferences";
import type { Locale } from "@/features/i18n/registry";
import { formatDateTime } from "@/lib/localeFormatting";
import { useFormatters } from "@/lib/useFormatters";
import { LanguageSettings } from "./LanguageSettings";

const { save } = vi.hoisted(() => ({
  save: vi.fn<(input: unknown, csrfToken: string | null) => Promise<{ ok: boolean }>>(() =>
    Promise.resolve({ ok: true }),
  ),
}));
vi.mock("@/features/i18n/actions", () => ({ saveLocalePreferencesAction: save }));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "test-csrf" }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

function openFormats(locale: Locale = "fa"): void {
  const labels = { en: "Customize formats", de: "Formate anpassen", fa: "سفارشی‌سازی قالب‌ها" };
  fireEvent.click(screen.getByRole("button", { name: labels[locale] }));
}

function Preview() {
  const format = useFormatters();
  return (
    <>
      <output data-testid="number">{format.number(1234.5)}</output>
      <output data-testid="date">{format.dateOnly("2026-03-21")}</output>
    </>
  );
}

it("saves a new timezone with the existing language, calendar and digits, and updates the preview", async () => {
  const user = userEvent.setup();
  render(
    <LocaleProvider locale="fa" calendar="persian" numberingSystem="latn" timeZone="Europe/Berlin">
      <LanguageSettings />
    </LocaleProvider>,
  );
  await user.click(screen.getByRole("combobox", { name: "منطقه زمانی" }));
  await user.click(screen.getByRole("option", { name: "Asia/Tehran" }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(
      {
        locale: "fa",
        calendar: "persian",
        numberingSystem: "latn",
        timeZone: "Asia/Tehran",
        timeZoneMode: "manual",
      },
      "test-csrf",
    ),
  );
  const expected = formatDateTime(
    "2026-03-21T09:30:00Z",
    {
      locale: "fa",
      calendar: "persian",
      numberingSystem: "latn",
      timeZone: "Asia/Tehran",
    },
    { hour: "2-digit", minute: "2-digit", hourCycle: "h23" },
  );
  expect(screen.getByText(expected)).toBeInTheDocument();
});

it("keeps an existing timezone outside the suggested list selectable", () => {
  render(
    <LocaleProvider timeZone="Pacific/Auckland">
      <LanguageSettings />
    </LocaleProvider>,
  );
  expect(screen.getByRole("combobox", { name: "Time zone" })).toHaveTextContent("Pacific/Auckland");
  expect(save).not.toHaveBeenCalled();
});

it("saves English digits while keeping Farsi text and unfinished input", async () => {
  const user = userEvent.setup();
  render(
    <LocaleProvider locale="fa">
      <LanguageSettings />
      <Preview />
      <input aria-label="draft" defaultValue="" />
    </LocaleProvider>,
  );
  fireEvent.change(screen.getByLabelText("draft"), { target: { value: "یادداشت ناتمام" } });
  expect(screen.getByTestId("number")).toHaveTextContent("۱٬۲۳۴٫۵");
  openFormats();
  await user.click(screen.getByRole("combobox", { name: "نمایش اعداد" }));
  await user.click(screen.getByRole("option", { name: "اعداد انگلیسی (123)" }));
  expect(screen.getByTestId("number")).toHaveTextContent("1,234.5");
  expect(screen.getByLabelText("draft")).toHaveValue("یادداشت ناتمام");
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ locale: "fa", numberingSystem: "latn" }),
      "test-csrf",
    ),
  );
});

it.each<{
  calendar: CalendarSystem;
  selected: string;
}>([
  { calendar: "persian", selected: "هجری شمسی (ایران)" },
  { calendar: "gregory", selected: "میلادی" },
])("shows the saved $calendar calendar in Farsi settings", ({ calendar, selected }) => {
  render(
    <LocaleProvider locale="fa" calendar={calendar}>
      <LanguageSettings />
    </LocaleProvider>,
  );
  openFormats();
  expect(screen.getByRole("combobox", { name: "تقویم" })).toHaveTextContent(selected);
  expect(save).not.toHaveBeenCalled();
});

it.each<{ locale: Locale; label: string }>([
  { locale: "en", label: "Calendar" },
  { locale: "de", label: "Kalender" },
])(
  "hides the calendar choice in $locale without resetting the saved calendar",
  ({ locale, label }) => {
    render(
      <LocaleProvider locale={locale} calendar="persian" numberingSystem="latn">
        <LanguageSettings />
        <Preview />
      </LocaleProvider>,
    );
    openFormats(locale);
    expect(screen.queryByRole("combobox", { name: label })).not.toBeInTheDocument();
    expect(screen.getByTestId("date")).toHaveTextContent("1405");
    expect(save).not.toHaveBeenCalled();
  },
);

it("saves the Iranian calendar while keeping Farsi text, number style, zone and a draft", async () => {
  const user = userEvent.setup();
  render(
    <LocaleProvider locale="fa" calendar="gregory" numberingSystem="latn" timeZone="Asia/Tehran">
      <LanguageSettings />
      <Preview />
      <input aria-label="draft" defaultValue="Keep this draft" />
    </LocaleProvider>,
  );
  expect(screen.getByTestId("date")).toHaveTextContent("2026");
  openFormats();
  await user.click(screen.getByRole("combobox", { name: "تقویم" }));
  await user.click(screen.getByRole("option", { name: "هجری شمسی (ایران)" }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(
      { locale: "fa", calendar: "persian", numberingSystem: "latn", timeZone: "Asia/Tehran" },
      "test-csrf",
    ),
  );
  expect(screen.getByRole("combobox", { name: "زبان" })).toHaveTextContent("فارسی");
  expect(screen.getByTestId("date")).toHaveTextContent("1405");
  expect(screen.getByTestId("number")).toHaveTextContent("1,234.5");
  expect(screen.getByLabelText("draft")).toHaveValue("Keep this draft");
});

it("reveals the saved calendar only while switching the workspace language to Farsi", async () => {
  const user = userEvent.setup();
  render(
    <LocaleProvider locale="en" calendar="persian" numberingSystem="latn" timeZone="Asia/Tehran">
      <LanguageSettings />
      <Preview />
    </LocaleProvider>,
  );
  openFormats("en");
  expect(screen.queryByRole("combobox", { name: "Calendar" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("combobox", { name: "Language" }));
  await user.click(screen.getByRole("option", { name: "فارسی" }));
  await waitFor(() => expect(screen.getByRole("combobox", { name: "زبان" })).toBeEnabled());
  expect(screen.getByRole("combobox", { name: "تقویم" })).toHaveTextContent("هجری شمسی (ایران)");
  expect(save).toHaveBeenNthCalledWith(
    1,
    { locale: "fa", calendar: "persian", numberingSystem: "latn", timeZone: "Asia/Tehran" },
    "test-csrf",
  );
  await user.click(screen.getByRole("combobox", { name: "زبان" }));
  await user.click(screen.getByRole("option", { name: "English" }));
  await waitFor(() => expect(screen.getByRole("combobox", { name: "Language" })).toBeEnabled());
  expect(screen.queryByRole("combobox", { name: "Calendar" })).not.toBeInTheDocument();
  expect(save).toHaveBeenNthCalledWith(
    2,
    { locale: "en", calendar: "persian", numberingSystem: "latn", timeZone: "Asia/Tehran" },
    "test-csrf",
  );
  expect(screen.getByTestId("date")).toHaveTextContent("1405");
});

it("announces the calendar save and disables all preference choices while it is pending", async () => {
  const user = userEvent.setup();
  let completeSave: (value: { ok: boolean }) => void = () => undefined;
  save.mockReturnValueOnce(
    new Promise<{ ok: boolean }>((resolve) => {
      completeSave = resolve;
    }),
  );
  render(
    <LocaleProvider locale="fa" calendar="persian" numberingSystem="latn">
      <LanguageSettings />
    </LocaleProvider>,
  );
  openFormats();
  await user.click(screen.getByRole("combobox", { name: "تقویم" }));
  await user.click(screen.getByRole("option", { name: "میلادی" }));
  await waitFor(() => expect(save).toHaveBeenCalled());
  expect(screen.getByRole("status")).toHaveTextContent("در حال ذخیره تنظیمات زبان و منطقه");
  for (const choice of screen.getAllByRole("combobox")) expect(choice).toBeDisabled();
  expect(screen.getByRole("button", { name: "کشور" })).toBeDisabled();
  expect(screen.getByRole("switch", { name: "تنظیم خودکار منطقهٔ زمانی" })).toBeDisabled();
  await act(() => Promise.resolve(completeSave({ ok: true })));
  await waitFor(() => expect(screen.getByRole("combobox", { name: "تقویم" })).toBeEnabled());
  expect(screen.getByRole("combobox", { name: "تقویم" })).toHaveTextContent("میلادی");
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

it("restores the saved calendar after a failed save without losing the Farsi draft or digits", async () => {
  const user = userEvent.setup();
  save.mockResolvedValueOnce({ ok: false });
  render(
    <LocaleProvider locale="fa" calendar="persian" numberingSystem="latn" timeZone="Asia/Tehran">
      <LanguageSettings />
      <Preview />
      <input aria-label="draft" defaultValue="یادداشت ناتمام" />
    </LocaleProvider>,
  );
  openFormats();
  await user.click(screen.getByRole("combobox", { name: "تقویم" }));
  await user.click(screen.getByRole("option", { name: "میلادی" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("تنظیمات زبان و منطقه ذخیره نشد");
  expect(screen.getByRole("combobox", { name: "تقویم" })).toHaveTextContent("هجری شمسی (ایران)");
  expect(screen.getByRole("combobox", { name: "زبان" })).toHaveTextContent("فارسی");
  expect(screen.getByTestId("date")).toHaveTextContent("1405");
  expect(screen.getByTestId("number")).toHaveTextContent("1,234.5");
  expect(screen.getByLabelText("draft")).toHaveValue("یادداشت ناتمام");
});

it("puts country before language and keeps automatic timezone and formats compact by default", () => {
  render(
    <LocaleProvider country="DE" locale="en" timeZone="Europe/Berlin" timeZoneMode="browser">
      <LanguageSettings />
    </LocaleProvider>,
  );
  const country = screen.getByRole("button", { name: "Country" });
  const language = screen.getByRole("combobox", { name: "Language" });
  expect(country).toHaveTextContent("Germany");
  expect(country.compareDocumentPosition(language) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getByRole("switch", { name: "Set time zone automatically" })).toBeChecked();
  expect(screen.getByText("Europe/Berlin")).toBeInTheDocument();
  expect(screen.queryByRole("combobox", { name: "Time zone" })).not.toBeInTheDocument();
  expect(screen.queryByRole("combobox", { name: "Number display" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Customize formats" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  expect(save).not.toHaveBeenCalled();
});

it("hides Iran-specific options for an English user in Germany even after opening formats", () => {
  render(
    <LocaleProvider country="DE" locale="en">
      <LanguageSettings />
    </LocaleProvider>,
  );
  openFormats("en");
  expect(screen.queryByRole("combobox", { name: "Number display" })).not.toBeInTheDocument();
  expect(
    screen.queryByRole("combobox", { name: "Display Iranian amounts in" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByText("Persian digits (۱۲۳)")).not.toBeInTheDocument();
});

it("shows relevant Iranian formats for a Farsi user in Iran", () => {
  render(
    <LocaleProvider country="IR" locale="fa">
      <LanguageSettings />
    </LocaleProvider>,
  );
  openFormats();
  expect(screen.getByRole("combobox", { name: "نمایش اعداد" })).toBeInTheDocument();
  expect(screen.getByRole("combobox", { name: "تقویم" })).toBeInTheDocument();
  expect(screen.getByRole("combobox", { name: "واحد نمایش مبلغ‌های ریالی" })).toBeInTheDocument();
});

it("saves country defaults while keeping the chosen language, timezone, money unit and draft", async () => {
  const user = userEvent.setup();
  render(
    <LocaleProvider
      country="DE"
      locale="en"
      calendar="persian"
      numberingSystem="arabext"
      timeZone="Europe/Berlin"
      timeZoneMode="browser"
      iranianMoneyUnit="toman"
    >
      <LanguageSettings />
      <Preview />
      <input aria-label="draft" defaultValue="Keep this draft" />
    </LocaleProvider>,
  );
  await user.click(screen.getByRole("button", { name: "Country" }));
  await user.click(screen.getByRole("option", { name: "United Kingdom", exact: true }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(
      {
        country: "GB",
        locale: "en",
        calendar: "gregory",
        numberingSystem: "latn",
        timeZone: "Europe/Berlin",
        timeZoneMode: "browser",
        iranianMoneyUnit: "toman",
      },
      "test-csrf",
    ),
  );
  expect(screen.getByRole("button", { name: "Country" })).toHaveTextContent("United Kingdom");
  expect(screen.getByRole("combobox", { name: "Language" })).toHaveTextContent("English");
  expect(screen.getByTestId("date")).toHaveTextContent("2026");
  expect(screen.getByLabelText("draft")).toHaveValue("Keep this draft");
});

it("restores the country and formats after a failed country save without losing a draft", async () => {
  const user = userEvent.setup();
  save.mockResolvedValueOnce({ ok: false });
  render(
    <LocaleProvider country="DE" locale="en" calendar="gregory" numberingSystem="latn">
      <LanguageSettings />
      <input aria-label="draft" defaultValue="Keep this draft" />
    </LocaleProvider>,
  );
  await user.click(screen.getByRole("button", { name: "Country" }));
  await user.click(screen.getByRole("option", { name: "Iran", exact: true }));
  expect(await screen.findByRole("alert")).toHaveTextContent("could not be saved");
  expect(screen.getByRole("button", { name: "Country" })).toHaveTextContent("Germany");
  openFormats("en");
  expect(
    screen.queryByRole("combobox", { name: "Display Iranian amounts in" }),
  ).not.toBeInTheDocument();
  expect(screen.getByLabelText("draft")).toHaveValue("Keep this draft");
});

it("lets the user turn off browser timezone and then return to the browser's current zone", async () => {
  const browserOptions = new Intl.DateTimeFormat().resolvedOptions();
  vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
    ...browserOptions,
    timeZone: "Asia/Tokyo",
  });
  const user = userEvent.setup();
  render(
    <LocaleProvider country="DE" locale="en" timeZone="Europe/Berlin" timeZoneMode="browser">
      <LanguageSettings />
    </LocaleProvider>,
  );
  await user.click(screen.getByRole("switch", { name: "Set time zone automatically" }));
  await waitFor(() =>
    expect(save).toHaveBeenLastCalledWith(
      expect.objectContaining({ timeZone: "Europe/Berlin", timeZoneMode: "manual" }),
      "test-csrf",
    ),
  );
  expect(screen.getByRole("combobox", { name: "Time zone" })).toHaveTextContent("Europe/Berlin");
  await waitFor(() =>
    expect(screen.getByRole("switch", { name: "Set time zone automatically" })).toBeEnabled(),
  );
  await user.click(screen.getByRole("switch", { name: "Set time zone automatically" }));
  await waitFor(() =>
    expect(save).toHaveBeenLastCalledWith(
      expect.objectContaining({ timeZone: "Asia/Tokyo", timeZoneMode: "browser" }),
      "test-csrf",
    ),
  );
  expect(screen.getByRole("switch", { name: "Set time zone automatically" })).toBeChecked();
  expect(screen.queryByRole("combobox", { name: "Time zone" })).not.toBeInTheDocument();
});

it("uses automatic timezone for a legacy default UTC while retaining an explicit manual UTC", () => {
  const { rerender } = render(
    <LocaleProvider timeZone="UTC">
      <LanguageSettings />
    </LocaleProvider>,
  );
  expect(screen.getByRole("switch", { name: "Set time zone automatically" })).toBeChecked();
  rerender(
    <LocaleProvider timeZone="UTC" timeZoneMode="manual">
      <LanguageSettings />
    </LocaleProvider>,
  );
  expect(screen.getByRole("switch", { name: "Set time zone automatically" })).not.toBeChecked();
  expect(screen.getByRole("combobox", { name: "Time zone" })).toHaveTextContent("UTC");
  expect(save).not.toHaveBeenCalled();
});

it("allows a manual timezone outside the chosen country while preserving other preferences", async () => {
  const user = userEvent.setup();
  render(
    <LocaleProvider
      country="DE"
      locale="en"
      calendar="persian"
      numberingSystem="latn"
      timeZone="Europe/Berlin"
      timeZoneMode="manual"
    >
      <LanguageSettings />
    </LocaleProvider>,
  );
  await user.click(screen.getByRole("combobox", { name: "Time zone" }));
  await user.click(screen.getByRole("option", { name: "Asia/Tehran", exact: true }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(
      {
        country: "DE",
        locale: "en",
        calendar: "persian",
        numberingSystem: "latn",
        timeZone: "Asia/Tehran",
        timeZoneMode: "manual",
      },
      "test-csrf",
    ),
  );
  expect(screen.getByRole("button", { name: "Country" })).toHaveTextContent("Germany");
  expect(screen.getByRole("combobox", { name: "Time zone" })).toHaveTextContent("Asia/Tehran");
  expect(screen.getByRole("switch", { name: "Set time zone automatically" })).not.toBeChecked();
});

it("restores recommended Iranian formats while preserving the timezone, money unit and draft", async () => {
  const user = userEvent.setup();
  render(
    <LocaleProvider
      country="IR"
      locale="fa"
      calendar="gregory"
      numberingSystem="latn"
      timeZone="Europe/Berlin"
      timeZoneMode="manual"
      iranianMoneyUnit="toman"
    >
      <LanguageSettings />
      <Preview />
      <input aria-label="draft" defaultValue="یادداشت ناتمام" />
    </LocaleProvider>,
  );
  openFormats();
  await user.click(screen.getByRole("button", { name: "استفاده از قالب‌های پیشنهادی" }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(
      {
        country: "IR",
        locale: "fa",
        calendar: "persian",
        numberingSystem: "arabext",
        timeZone: "Europe/Berlin",
        timeZoneMode: "manual",
        iranianMoneyUnit: "toman",
      },
      "test-csrf",
    ),
  );
  expect(screen.getByRole("combobox", { name: "تقویم" })).toHaveTextContent("هجری شمسی (ایران)");
  expect(screen.getByRole("combobox", { name: "نمایش اعداد" })).toHaveTextContent(
    "اعداد فارسی (۱۲۳)",
  );
  expect(screen.getByTestId("date")).toHaveTextContent("۱۴۰۵");
  expect(screen.getByTestId("number")).toHaveTextContent("۱٬۲۳۴٫۵");
  expect(screen.getByLabelText("draft")).toHaveValue("یادداشت ناتمام");
});

it("adapts recommended formats when an Iranian user changes the interface language to Farsi", async () => {
  const user = userEvent.setup();
  render(
    <LocaleProvider
      country="IR"
      locale="en"
      calendar="gregory"
      numberingSystem="latn"
      timeZone="Asia/Tehran"
      timeZoneMode="manual"
    >
      <LanguageSettings />
      <Preview />
    </LocaleProvider>,
  );
  await user.click(screen.getByRole("combobox", { name: "Language" }));
  await user.click(screen.getByRole("option", { name: "فارسی", exact: true }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(
      {
        country: "IR",
        locale: "fa",
        calendar: "persian",
        numberingSystem: "arabext",
        timeZone: "Asia/Tehran",
        timeZoneMode: "manual",
      },
      "test-csrf",
    ),
  );
  openFormats();
  expect(screen.getByRole("combobox", { name: "تقویم" })).toHaveTextContent("هجری شمسی (ایران)");
  expect(screen.getByRole("combobox", { name: "نمایش اعداد" })).toHaveTextContent(
    "اعداد فارسی (۱۲۳)",
  );
  expect(screen.getByTestId("date")).toHaveTextContent("۱۴۰۵");
  expect(screen.getByTestId("number")).toHaveTextContent("۱٬۲۳۴٫۵");
});
