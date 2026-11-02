// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { useFormatters } from "@/lib/useFormatters";
import { LanguageSettings } from "./LanguageSettings";

const { save } = vi.hoisted(() => ({ save: vi.fn(() => Promise.resolve({ ok: true })) }));
vi.mock("@/features/i18n/actions", () => ({ saveLocalePreferencesAction: save }));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function Amount() {
  const format = useFormatters();
  return <output data-testid="amount">{format.currency("1234560", "IRR")}</output>;
}

it.each([
  {
    locale: "en",
    digits: "Number display",
    money: "Display Iranian amounts in",
    rial: "Iranian rial (IRR)",
  },
  {
    locale: "de",
    digits: "Zifferndarstellung",
    money: "Iranische Beträge anzeigen in",
    rial: "Iranischer Rial (IRR)",
  },
] as const)(
  "keeps explicit Persian digits independent of toman display in $locale",
  async ({ locale, digits, money, rial }) => {
    const user = userEvent.setup();
    render(
      <LocaleProvider
        locale={locale}
        calendar="persian"
        timeZone="Asia/Tehran"
        numberingSystem="arabext"
        iranianMoneyUnit="toman"
      >
        <LanguageSettings />
        <Amount />
        <input aria-label="Draft" defaultValue="C01234 پیگیری" />
      </LocaleProvider>,
    );
    expect(screen.getByRole("combobox", { name: digits })).toBeVisible();
    expect(screen.getByTestId("amount")).toHaveTextContent(/toman/iu);
    expect(screen.getByTestId("amount")).toHaveTextContent(/[۰-۹]/u);
    expect(screen.getByTestId("amount")).not.toHaveTextContent(/[0-9]/u);
    await user.click(screen.getByRole("combobox", { name: money }));
    await user.click(screen.getByRole("option", { name: rial }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledExactlyOnceWith(
        {
          locale,
          calendar: "persian",
          timeZone: "Asia/Tehran",
          numberingSystem: "arabext",
          iranianMoneyUnit: "rial",
        },
        "csrf",
      ),
    );
    expect(screen.getByTestId("amount")).not.toHaveTextContent(/toman/iu);
    expect(screen.getByTestId("amount")).toHaveTextContent(/[۰-۹]/u);
    expect(screen.getByRole("textbox", { name: "Draft" })).toHaveValue("C01234 پیگیری");
  },
);
