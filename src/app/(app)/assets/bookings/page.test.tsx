// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type * as NextNavigation from "next/navigation";
import { afterEach, assert, beforeEach, expect, it, vi } from "vitest";
import { bookingAutomationDemoIds } from "@/features/assets/bookings/automations/fixture";
import type { BookingResult } from "@/features/assets/bookings/contracts";
import {
  createBookingFixture,
  fixtureHandoverBookingId,
} from "@/features/assets/bookings/fixtures";
import { projectBookings } from "@/features/assets/bookings/transitions";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import Page from "./page";

const mocks = vi.hoisted(() => ({
  fixture: true,
  actor: {
    id: "e4d6c8af-13c9-49c8-b138-d8472f77ec7d",
    name: "Equipment requester",
    type: "regular",
    isActive: true,
    projectsGuestOnly: false,
  },
  workspace: vi.fn<() => Promise<BookingResult>>(),
}));

vi.mock("@/features/inventory/availability", () => ({
  inventoryFixturesEnabled: () => mocks.fixture,
}));
vi.mock("@/frontend/context", () => ({
  createContext: () => Promise.resolve({ actor: mocks.actor, projectGuest: null }),
  getBootstrap: () => Promise.resolve({ shell: { assetsAvailable: false } }),
}));
vi.mock("@/frontend/trpc", () => ({
  coreClient: () => ({ assets: { bookings: { workspace: { query: mocks.workspace } } } }),
}));
vi.mock("next/navigation", async (load) => ({
  ...(await load<typeof NextNavigation>()),
  notFound: () => {
    throw new Error("Booking unavailable");
  },
}));

const featured = "265e02cf-1208-480a-88a4-5931477f5273";
const title = "Bench meter for control cabinet verification";
const now = "2026-11-24T08:00:00.000Z";

function page(bookingId?: string | string[]) {
  return Page({ searchParams: Promise.resolve({ bookingId }) });
}

beforeEach(() => {
  mocks.fixture = true;
  mocks.workspace.mockReset();
});
afterEach(cleanup);

it("focuses the exact booking title from the fixture link and keeps routine navigation unfocused", async () => {
  const ordinary = render(<LocaleProvider locale="en">{await page()}</LocaleProvider>);
  expect(screen.getByRole("heading", { name: title })).not.toHaveFocus();
  ordinary.unmount();

  render(<LocaleProvider locale="en">{await page(featured.toUpperCase())}</LocaleProvider>);
  const heading = screen.getByRole("heading", { name: title });
  expect(heading).toHaveFocus();
  expect(heading.closest("[data-booking-detail]")).toHaveAttribute("data-booking-detail", featured);
});

it("rejects repeated, malformed, and unknown booking IDs", async () => {
  for (const value of [[featured, featured], "occupied-site-0", crypto.randomUUID()]) {
    await expect(page(value)).rejects.toThrow("Booking unavailable");
  }
});

it("keeps explicit handover demo links in their own fixture", async () => {
  await expect(page(fixtureHandoverBookingId)).rejects.toThrow("Booking unavailable");
  const handover = await Page({
    searchParams: Promise.resolve({ demo: "handover", bookingId: fixtureHandoverBookingId }),
  });
  render(<LocaleProvider locale="en">{handover}</LocaleProvider>);
  expect(screen.getByRole("heading", { name: "Controller bench handover" })).toHaveFocus();
});

it("opens a recipient's exact automation booking without exposing another recipient", async () => {
  const { sentBack, expired } = bookingAutomationDemoIds;
  const opened = await Page({
    searchParams: Promise.resolve({ demo: "automations", bookingId: sentBack }),
  });
  render(<LocaleProvider locale="en">{opened}</LocaleProvider>);
  expect(screen.getByRole("heading", { name: "Bench calibration request" })).toHaveFocus();
  const notices = screen.getByRole("region", { name: "Booking notices" });
  expect(await within(notices).findByText("Changes requested")).toBeInTheDocument();
  await expect(
    Page({ searchParams: Promise.resolve({ demo: "automations", bookingId: expired }) }),
  ).rejects.toThrow("Booking unavailable");
  await expect(page(sentBack)).rejects.toThrow("Booking unavailable");
});

it("opens an authorized archived booking on the correct site and rejects calendar-only occupancy", async () => {
  mocks.fixture = false;
  const initial = projectBookings(createBookingFixture(mocks.actor, false, now));
  const [source] = initial.bookings;
  const [, site] = initial.sites;
  assert(source !== undefined && site !== undefined);
  const archived = {
    ...source,
    id: crypto.randomUUID(),
    siteId: site.id,
    archived: true,
    title: "Archived calibration booking",
  };
  const blockedId = crypto.randomUUID();
  mocks.workspace.mockResolvedValue({
    ok: true,
    bookingId: null,
    value: {
      ...initial,
      bookings: [source, archived],
      calendar: [
        {
          id: blockedId,
          siteId: site.id,
          bookingId: null,
          title: null,
          kind: "confirmed",
          window: source.window,
        },
      ],
    },
  });

  render(<LocaleProvider locale="en">{await page(archived.id)}</LocaleProvider>);
  const heading = screen.getByRole("heading", { name: archived.title });
  expect(heading).toHaveFocus();
  const detail = heading.closest("[data-booking-detail]");
  expect(detail).toHaveAttribute("data-booking-detail", archived.id);
  expect(detail?.querySelector("[data-booking-status='archived']")).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: source.title })).not.toBeInTheDocument();
  await expect(page(blockedId)).rejects.toThrow("Booking unavailable");
});
