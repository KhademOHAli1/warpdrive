// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { LocaleProvider } from "./LocaleProvider";

const save = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({ saveLocalePreferencesAction: save }));

afterEach(() => {
  cleanup();
  save.mockReset();
});

it("offers all three languages and preserves calendar, zone and an unsaved draft", async () => {
  save.mockResolvedValue({ ok: true });
  const user = userEvent.setup();
  render(
    <LocaleProvider locale="fa" calendar="persian" timeZone="Asia/Tehran">
      <LanguageSwitcher />
      <input aria-label="Draft" defaultValue="قرارداد ناتمام" />
    </LocaleProvider>,
  );
  await user.click(screen.getByRole("button", { name: "زبان" }));
  for (const name of ["English", "فارسی", "Deutsch"]) {
    expect(screen.getByRole("menuitemradio", { name })).toBeInTheDocument();
  }
  await user.click(screen.getByRole("menuitemradio", { name: "Deutsch" }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(
      { locale: "de", calendar: "persian", timeZone: "Asia/Tehran" },
      null,
    ),
  );
  expect(screen.getByRole("button", { name: "Sprache" })).toHaveTextContent("Deutsch");
  expect(screen.getByLabelText("Draft")).toHaveValue("قرارداد ناتمام");
  expect(document.documentElement).toHaveAttribute("lang", "de");
  expect(document.documentElement).toHaveAttribute("dir", "ltr");
});
