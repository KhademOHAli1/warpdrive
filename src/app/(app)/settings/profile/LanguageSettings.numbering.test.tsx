// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
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

it.each([
  {
    locale: "fa",
    calendar: "gregory",
    label: "نمایش اعداد",
    persian: "اعداد فارسی (۱۲۳)",
    latin: "اعداد انگلیسی (123)",
    year: "۲۰۲۶",
  },
  {
    locale: "de",
    calendar: "persian",
    label: "Zifferndarstellung",
    persian: "Persische Ziffern (۱۲۳)",
    latin: "Lateinische Ziffern (123)",
    year: "۱۴۰۵",
  },
  {
    locale: "en",
    calendar: "gregory",
    label: "Number display",
    persian: "Persian digits (۱۲۳)",
    latin: "English digits (123)",
    year: "۲۰۲۶",
  },
] as const)(
  "saves both digit choices in $locale without changing calendar, zone or a raw draft",
  async ({ locale, calendar, label, persian, latin, year }) => {
    const user = userEvent.setup();
    render(
      <LocaleProvider
        locale={locale}
        calendar={calendar}
        numberingSystem="latn"
        timeZone="Europe/Berlin"
      >
        <LanguageSettings />
        <Preview />
        <input aria-label="draft" defaultValue="" />
      </LocaleProvider>,
    );
    fireEvent.change(screen.getByLabelText("draft"), { target: { value: "C01234 پیگیری" } });
    expect(screen.getByRole("combobox", { name: label })).toHaveTextContent(latin);
    expect(save).not.toHaveBeenCalled();
    await user.click(screen.getByRole("combobox", { name: label }));
    await user.click(screen.getByRole("option", { name: persian }));
    await waitFor(() =>
      expect(save).toHaveBeenNthCalledWith(
        1,
        { locale, calendar, numberingSystem: "arabext", timeZone: "Europe/Berlin" },
        "test-csrf",
      ),
    );
    expect(screen.getByTestId("number")).toHaveTextContent(/[۰-۹]/);
    expect(screen.getByTestId("number")).not.toHaveTextContent(/[0-9]/);
    expect(screen.getByTestId("date")).toHaveTextContent(year);
    expect(screen.getByLabelText("draft")).toHaveValue("C01234 پیگیری");
    await waitFor(() => expect(screen.getByRole("combobox", { name: label })).toBeEnabled());
    await user.click(screen.getByRole("combobox", { name: label }));
    await user.click(screen.getByRole("option", { name: latin }));
    await waitFor(() =>
      expect(save).toHaveBeenNthCalledWith(
        2,
        { locale, calendar, numberingSystem: "latn", timeZone: "Europe/Berlin" },
        "test-csrf",
      ),
    );
    expect(save).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("number")).toHaveTextContent(/[0-9]/);
    expect(screen.getByTestId("number")).not.toHaveTextContent(/[۰-۹]/);
    expect(screen.getByTestId("date")).toHaveTextContent(calendar === "persian" ? "1405" : "2026");
    expect(screen.getByLabelText("draft")).toHaveValue("C01234 پیگیری");
  },
);

it("does not store a numbering default when only the language changes", async () => {
  const user = userEvent.setup();
  render(
    <LocaleProvider locale="en" calendar="gregory" timeZone="Europe/Berlin">
      <LanguageSettings />
      <Preview />
    </LocaleProvider>,
  );
  expect(save).not.toHaveBeenCalled();
  await user.click(screen.getByRole("combobox", { name: "Language" }));
  await user.click(screen.getByRole("option", { name: "فارسی" }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledExactlyOnceWith(
      { locale: "fa", calendar: "gregory", timeZone: "Europe/Berlin" },
      "test-csrf",
    ),
  );
  const saved = save.mock.calls[0]?.[0];
  expect(saved).not.toHaveProperty("numberingSystem");
  expect(screen.getByTestId("number")).toHaveTextContent(/[۰-۹]/);
  expect(screen.getByTestId("date")).toHaveTextContent("۲۰۲۶");
});

it("preserves an explicit digit choice when only the language changes", async () => {
  const user = userEvent.setup();
  render(
    <LocaleProvider
      locale="de"
      calendar="persian"
      timeZone="Europe/Berlin"
      numberingSystem="arabext"
    >
      <LanguageSettings />
      <Preview />
      <input aria-label="draft" defaultValue="C01234 پیگیری" />
    </LocaleProvider>,
  );
  expect(screen.getByTestId("number")).toHaveTextContent(/[۰-۹]/);
  expect(save).not.toHaveBeenCalled();
  await user.click(screen.getByRole("combobox", { name: "Sprache" }));
  await user.click(screen.getByRole("option", { name: "English" }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledExactlyOnceWith(
      { locale: "en", calendar: "persian", timeZone: "Europe/Berlin", numberingSystem: "arabext" },
      "test-csrf",
    ),
  );
  expect(screen.getByRole("combobox", { name: "Language" })).toHaveTextContent("English");
  expect(screen.getByTestId("number")).toHaveTextContent(/[۰-۹]/);
  expect(screen.getByTestId("number")).not.toHaveTextContent(/[0-9]/);
  expect(screen.getByTestId("date")).toHaveTextContent("۱۴۰۵");
  expect(screen.getByLabelText("draft")).toHaveValue("C01234 پیگیری");
});
