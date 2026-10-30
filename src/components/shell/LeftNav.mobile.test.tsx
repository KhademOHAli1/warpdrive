// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { LeftNav } from "./LeftNav";
import { MobileNavTrigger } from "./MobileNavTrigger";

vi.mock("next/navigation", () => ({ usePathname: () => "/pipeline" }));
vi.stubGlobal("matchMedia", (media: string) => ({
  media,
  matches: false,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
}));
afterEach(cleanup);

it("opens the Farsi navigation from the right and restores focus after Escape", async () => {
  const user = userEvent.setup();
  render(
    <LocaleProvider locale="fa">
      <header>
        <MobileNavTrigger />
      </header>
      <LeftNav />
    </LocaleProvider>,
  );
  const trigger = within(screen.getByRole("banner")).getByRole("button", {
    name: "باز کردن نوار کناری",
  });
  await user.click(trigger);
  const dialog = await screen.findByRole("dialog", { name: "ناوبری اصلی" });
  expect(dialog).toHaveAttribute("data-side", "right");
  expect(within(dialog).getByRole("link", { name: "مخاطبان" })).toBeVisible();
  const close = within(dialog).getByRole("button", { name: "بستن" });
  expect(close).toHaveFocus();
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(trigger).toHaveFocus();
});
