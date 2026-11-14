// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { LeftNav } from "./LeftNav";
import { MobileNavTrigger } from "./MobileNavTrigger";

const route = vi.hoisted(() => ({ pathname: "/pipeline" }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname }));
vi.stubGlobal("matchMedia", (media: string) => ({
  media,
  matches: false,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
}));
afterEach(() => {
  cleanup();
  route.pathname = "/pipeline";
});

it.each(["Contacts", "Activities"])(
  "opens %s destinations and closes the drawer after choosing a child",
  async (label) => {
    const user = userEvent.setup();
    render(
      <>
        <header>
          <MobileNavTrigger />
        </header>
        <LeftNav />
      </>,
    );
    const trigger = within(screen.getByRole("banner")).getByRole("button", {
      name: "Expand sidebar",
    });
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    expect(trigger).not.toHaveAttribute("aria-pressed");
    await user.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "Primary" });
    expect(within(dialog).queryByRole("button", { name: "Pin sidebar" })).not.toBeInTheDocument();
    for (const utility of ["Settings", "Workflows", "Help & docs"]) {
      expect(within(dialog).getByRole("link", { name: utility })).toBeVisible();
    }
    await user.click(within(dialog).getByRole("button", { name: label }));
    expect(dialog).toBeInTheDocument();
    document.addEventListener("click", (event) => event.preventDefault(), { once: true });
    await user.click(
      within(dialog).getByRole("link", { name: label === "Contacts" ? "People" : "List" }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  },
);

it("announces the current child within the mobile navigation", async () => {
  route.pathname = "/contacts/people/person-1";
  const user = userEvent.setup();
  render(
    <>
      <header>
        <MobileNavTrigger />
      </header>
      <LeftNav />
    </>,
  );
  await user.click(
    within(screen.getByRole("banner")).getByRole("button", { name: "Expand sidebar" }),
  );
  const dialog = await screen.findByRole("dialog", { name: "Primary" });
  const navigation = within(dialog).getByRole("navigation", { name: "Primary" });
  expect(within(navigation).getByRole("link", { name: "People", current: "page" })).toBeVisible();
  expect(navigation.querySelectorAll('a[aria-current="page"]')).toHaveLength(1);
});

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
  expect(
    within(dialog).queryByRole("button", { name: "سنجاق کردن نوار کناری" }),
  ).not.toBeInTheDocument();
  expect(within(dialog).getByRole("button", { name: "مخاطبان" })).toBeVisible();
  const close = within(dialog).getByRole("button", { name: "بستن" });
  expect(close).toHaveFocus();
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(trigger).toHaveFocus();
});
