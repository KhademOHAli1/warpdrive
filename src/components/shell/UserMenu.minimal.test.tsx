// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { UserMenu } from "./UserMenu";

const { saveAppearance } = vi.hoisted(() => ({
  saveAppearance: vi.fn(() => Promise.resolve({ ok: true })),
}));
vi.mock("@/features/identity/preferencesActions", () => ({ setAppearanceAction: saveAppearance }));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("shows three icon-only appearance choices without a heading or submenu", async () => {
  const user = userEvent.setup();
  render(<UserMenu userId="u1" />);
  await user.click(screen.getByRole("button", { name: "Account menu" }));
  const menu = screen.getByRole("menu");
  expect(
    within(menu)
      .getAllByRole("menuitem")
      .map((item) => item.textContent),
  ).toEqual(["Settings", "Log out"]);
  const modes = screen.getAllByRole("menuitemradio");
  expect(modes.map((item) => item.getAttribute("aria-label"))).toEqual(["System", "Light", "Dark"]);
  expect(modes.every((item) => item.textContent === "")).toBe(true);
  expect(screen.queryByText("Appearance")).not.toBeInTheDocument();
  expect(screen.queryByText("My account")).not.toBeInTheDocument();
  expect(screen.queryByText("فارسی")).not.toBeInTheDocument();
});

it("supports horizontal RTL keys and remembers an icon choice when reopening", async () => {
  const user = userEvent.setup();
  render(
    <LocaleProvider locale="fa">
      <UserMenu userId="u1" appearance="night" />
    </LocaleProvider>,
  );
  await user.click(screen.getByRole("button", { name: "منوی حساب کاربری" }));
  expect(screen.getByRole("menuitemradio", { name: "تیره" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  screen.getByRole("menuitemradio", { name: "مطابق تنظیم دستگاه" }).focus();
  await user.keyboard("{ArrowLeft}");
  expect(screen.getByRole("menuitemradio", { name: "روشن" })).toHaveFocus();
  await user.keyboard("{Enter}");
  await waitFor(() => expect(saveAppearance).toHaveBeenCalledWith({ appearance: "day" }, "csrf"));
  await user.click(screen.getByRole("button", { name: "منوی حساب کاربری" }));
  expect(await screen.findByRole("menuitemradio", { name: "روشن" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
});
