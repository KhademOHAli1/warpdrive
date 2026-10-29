// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { FilterableCalendar } from "./FilterableCalendar";

const types = vi.hoisted(() => ({
  data: [{ key: "call", name: "Call", isSystem: true }],
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    activities: { listTypes: { useQuery: () => types } },
    identity: { assignableUsers: { useQuery: () => ({ data: [] }) } },
  },
}));
vi.mock("./CalendarClient", () => ({ CalendarClient: () => null }));
vi.mock("./CalendarEmpty", () => ({ CalendarEmpty: () => null }));

afterEach(() => {
  cleanup();
  types.data = [{ key: "call", name: "Call", isSystem: true }];
});

it.each([
  ["fa", "تماس"],
  ["en", "Call"],
] as const)("uses %s display names for selectable built-in filters", (locale, label) => {
  render(
    <LocaleProvider locale={locale}>
      <FilterableCalendar view="week" anchorIso="2026-10-29" dayIsos={[]} activities={[]} />
    </LocaleProvider>,
  );
  const tab = screen.getByRole("button", { name: label });
  expect(tab).toHaveAttribute("aria-pressed", "false");
  fireEvent.click(tab);
  expect(tab).toHaveAttribute("aria-pressed", "true");
});

it("preserves a custom type even when its key and name resemble a built-in", () => {
  types.data = [{ key: "call", name: "Call", isSystem: false }];
  render(
    <LocaleProvider locale="fa">
      <FilterableCalendar view="week" anchorIso="2026-10-29" dayIsos={[]} activities={[]} />
    </LocaleProvider>,
  );
  expect(screen.getByRole("button", { name: "Call" })).toBeInTheDocument();
});
