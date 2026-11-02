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
function Amounts() {
  const format = useFormatters();
  return (
    <>
      <output data-testid="irr">{format.currency("1234560", "IRR")}</output>
      <output data-testid="eur">{format.currency("1234.50", "EUR")}</output>
    </>
  );
}
it("selects toman in Farsi and keeps that independent choice when switching to German", async () => {
  const user = userEvent.setup();
  render(
    <LocaleProvider locale="fa">
      <LanguageSettings />
      <Amounts />
      <input aria-label="Draft" defaultValue="یادداشت ناتمام" />
    </LocaleProvider>,
  );
  await user.click(screen.getByRole("combobox", { name: "واحد نمایش مبلغ‌های ریالی" }));
  await user.click(screen.getByRole("option", { name: "تومان (۱۰ ریال)" }));
  expect(screen.getByTestId("irr").textContent).toBe("۱۲۳٬۴۵۶ تومان");
  await user.click(screen.getByRole("combobox", { name: "زبان" }));
  await user.click(screen.getByRole("option", { name: "Deutsch" }));
  expect(screen.getByTestId("irr").textContent).toBe("123.456 Toman");
  expect(screen.getByTestId("eur").textContent).toBe("1.234,5 €");
  expect(screen.getByRole("textbox", { name: "Draft" })).toHaveValue("یادداشت ناتمام");
  await waitFor(() =>
    expect(save).toHaveBeenLastCalledWith(
      expect.objectContaining({ locale: "de", iranianMoneyUnit: "toman" }),
      "csrf",
    ),
  );
});

it("restores the saved rial display when persisting the new unit fails", async () => {
  save.mockResolvedValueOnce({ ok: false });
  const user = userEvent.setup();
  render(
    <LocaleProvider locale="de">
      <LanguageSettings />
      <Amounts />
    </LocaleProvider>,
  );
  await user.click(screen.getByRole("combobox", { name: "Iranische Beträge anzeigen in" }));
  await user.click(screen.getByRole("option", { name: "Toman (10 Rial)" }));
  expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(screen.getByRole("combobox", { name: "Iranische Beträge anzeigen in" })).toHaveTextContent(
    "Iranischer Rial (IRR)",
  );
  expect(screen.getByTestId("irr").textContent).not.toContain("Toman");
});
