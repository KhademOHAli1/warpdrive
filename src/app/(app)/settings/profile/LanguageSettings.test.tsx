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

const { save } = vi.hoisted(() => ({ save: vi.fn(() => Promise.resolve({ ok: true })) }));
vi.mock("@/features/i18n/actions", () => ({ saveLocalePreferencesAction: save }));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "test-csrf" }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

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
      { locale: "fa", calendar: "persian", numberingSystem: "latn", timeZone: "Asia/Tehran" },
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

it("shows the digit setting only after choosing Farsi", async () => {
  const user = userEvent.setup();
  render(
    <LocaleProvider>
      <LanguageSettings />
    </LocaleProvider>,
  );
  expect(screen.queryByRole("combobox", { name: "Number display" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("combobox", { name: "Language" }));
  await user.click(screen.getByRole("option", { name: "فارسی" }));
  expect(await screen.findByRole("combobox", { name: "نمایش اعداد" })).toBeInTheDocument();
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ locale: "fa" }), "test-csrf"),
  );
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
  locale: Locale;
  calendar: CalendarSystem;
  label: string;
  selected: string;
}>([
  { locale: "en", calendar: "persian", label: "Calendar", selected: "Solar Hijri (Iranian)" },
  { locale: "fa", calendar: "gregory", label: "تقویم", selected: "میلادی" },
])(
  "shows the saved $calendar calendar independently of $locale text",
  ({ locale, calendar, label, selected }) => {
    render(
      <LocaleProvider locale={locale} calendar={calendar}>
        <LanguageSettings />
      </LocaleProvider>,
    );
    expect(screen.getByRole("combobox", { name: label })).toHaveTextContent(selected);
    expect(save).not.toHaveBeenCalled();
  },
);

it("saves the Iranian calendar while keeping English text, number style, zone and a draft", async () => {
  const user = userEvent.setup();
  render(
    <LocaleProvider locale="en" calendar="gregory" numberingSystem="latn" timeZone="Asia/Tehran">
      <LanguageSettings />
      <Preview />
      <input aria-label="draft" defaultValue="Keep this draft" />
    </LocaleProvider>,
  );
  expect(screen.getByTestId("date")).toHaveTextContent("2026");
  await user.click(screen.getByRole("combobox", { name: "Calendar" }));
  await user.click(screen.getByRole("option", { name: "Solar Hijri (Iranian)" }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(
      { locale: "en", calendar: "persian", numberingSystem: "latn", timeZone: "Asia/Tehran" },
      "test-csrf",
    ),
  );
  expect(screen.getByRole("combobox", { name: "Language" })).toHaveTextContent("English");
  expect(screen.getByTestId("date")).toHaveTextContent("1405");
  expect(screen.getByTestId("number")).toHaveTextContent("1,234.5");
  expect(screen.getByLabelText("draft")).toHaveValue("Keep this draft");
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
  await user.click(screen.getByRole("combobox", { name: "تقویم" }));
  await user.click(screen.getByRole("option", { name: "میلادی" }));
  await waitFor(() => expect(save).toHaveBeenCalled());
  expect(screen.getByRole("status")).toHaveTextContent("در حال ذخیره تنظیمات زبان و منطقه");
  for (const choice of screen.getAllByRole("combobox")) expect(choice).toBeDisabled();
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
  await user.click(screen.getByRole("combobox", { name: "تقویم" }));
  await user.click(screen.getByRole("option", { name: "میلادی" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("تنظیمات زبان و منطقه ذخیره نشد");
  expect(screen.getByRole("combobox", { name: "تقویم" })).toHaveTextContent("هجری شمسی (ایران)");
  expect(screen.getByRole("combobox", { name: "زبان" })).toHaveTextContent("فارسی");
  expect(screen.getByTestId("date")).toHaveTextContent("1405");
  expect(screen.getByTestId("number")).toHaveTextContent("1,234.5");
  expect(screen.getByLabelText("draft")).toHaveValue("یادداشت ناتمام");
});
