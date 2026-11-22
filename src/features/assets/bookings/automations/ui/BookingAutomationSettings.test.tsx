// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, assert, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { BookingSite } from "../../contracts";
import { createBookingFixture } from "../../fixtures";
import type {
  BookingAutomationAccess,
  BookingAutomationRun,
  BookingAutomationRuns,
} from "../contracts";
import { BookingAutomationSettings } from "./BookingAutomationSettings";

const time = "2026-11-24T08:00:00.000Z";
const person = { id: "adb3514a-66c6-493d-b2be-ef508b1a2911", name: "Automation manager" };
const bookingId = "265e02cf-1208-480a-88a4-5931477f5273";
const runId = "380a2352-d324-4909-8384-83c8ca41176b";
const failureId = "7704d5cb-000f-4b5a-82fb-0af04b37ac3a";

const failed: BookingAutomationRun = {
  id: runId,
  bookingId,
  title: "Calibration bench booking",
  recipientName: "Calibration staff",
  trigger: "return_overdue",
  state: "failed",
  scheduledAt: time,
  dueAt: time,
  failureId,
  attempts: [{ id: failureId, at: time, outcome: "failed", reason: "temporary" }],
};
const runs: BookingAutomationRuns = {
  profile: { version: 1, triggers: ["return_overdue"] },
  runs: [failed],
  nextCursor: null,
};

function demoSite() {
  const [site] = createBookingFixture(person, true, time).sites;
  assert(site !== undefined);
  return site;
}

function connection(patch: Partial<BookingAutomationAccess> = {}): BookingAutomationAccess {
  return {
    readNotices: () => Promise.resolve({ ok: true, value: [] }),
    readRuns: () => Promise.resolve({ ok: true, value: runs }),
    saveProfile: () => Promise.resolve({ ok: false, error: "invalid" }),
    retry: () => Promise.resolve({ ok: false, error: "invalid" }),
    ...patch,
  };
}

function panel(site: BookingSite, access: BookingAutomationAccess) {
  return (
    <LocaleProvider locale="en">
      <BookingAutomationSettings {...{ site, access }} demo />
    </LocaleProvider>
  );
}

afterEach(cleanup);

it("rechecks on window focus, preserves a same-version draft, and clears revoked scope", async () => {
  const site = demoSite();
  let resolveFocus: (result: Awaited<ReturnType<BookingAutomationAccess["readRuns"]>>) => void =
    () => {};
  const pendingFocus = new Promise<Awaited<ReturnType<BookingAutomationAccess["readRuns"]>>>(
    (resolve) => {
      resolveFocus = resolve;
    },
  );
  const readRuns = vi
    .fn<BookingAutomationAccess["readRuns"]>()
    .mockResolvedValueOnce({ ok: true, value: runs })
    .mockReturnValueOnce(pendingFocus)
    .mockResolvedValueOnce({ ok: false, error: "unavailable" });
  render(panel(site, connection({ readRuns })));
  const draftRule = await screen.findByRole("checkbox", { name: "Changes requested" });
  fireEvent.click(draftRule);
  fireEvent(window, new Event("focus"));
  expect(screen.queryByRole("link", { name: failed.title })).not.toBeInTheDocument();
  expect(draftRule).toBeChecked();
  expect(screen.getByRole("button", { name: "Save notification rules" })).toBeDisabled();
  await act(async () => {
    resolveFocus({ ok: true, value: { ...runs, profile: { ...runs.profile } } });
    await pendingFocus;
  });
  expect(screen.getByRole("link", { name: failed.title })).toBeInTheDocument();
  expect(draftRule).toBeChecked();
  expect(screen.getByRole("button", { name: "Save notification rules" })).toBeEnabled();

  fireEvent(window, new Event("focus"));
  await screen.findByText("Booking notifications are unavailable at this site.");
  expect(screen.queryByRole("checkbox", { name: "Changes requested" })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: failed.title })).not.toBeInTheDocument();
  expect(screen.queryByRole("combobox", { name: "Run status" })).not.toBeInTheDocument();
});

it("pins the profile version and reuses the same request when a save's result is uncertain", async () => {
  const site = demoSite();
  const saveProfile = vi
    .fn<BookingAutomationAccess["saveProfile"]>()
    .mockRejectedValueOnce(new Error("Transport lost"))
    .mockImplementationOnce(({ triggers }) =>
      Promise.resolve({ ok: true, value: { version: 2, triggers } }),
    );
  render(panel(site, connection({ saveProfile })));
  const rule = await screen.findByRole("checkbox", { name: "Changes requested" });
  fireEvent.click(rule);
  fireEvent.click(screen.getByRole("button", { name: "Save notification rules" }));
  await screen.findByText("The request could not be confirmed. Try again.");
  fireEvent.click(screen.getByRole("button", { name: "Save notification rules" }));
  await screen.findByText("Notification rules saved.");
  expect(saveProfile).toHaveBeenCalledTimes(2);
  const first = saveProfile.mock.calls[0]?.[0];
  expect(first).toMatchObject({
    siteId: site.id,
    version: 1,
    triggers: ["request_sent_back", "return_overdue"],
    requestId: expect.any(String),
  });
  expect(saveProfile.mock.calls[1]?.[0]).toEqual(first);
  expect(screen.getByRole("checkbox", { name: "Changes requested" })).toBeChecked();
  expect(screen.getByRole("button", { name: "Save notification rules" })).toBeDisabled();
});

it("links the exact booking and retries only the named failed attempt", async () => {
  const site = demoSite();
  const conflictingRun = { ...failed, id: "unrelated", title: "Other booking", attempts: [] };
  const delivered = { ...failed, state: "delivered", failureId: null } as const;
  const readRuns = vi
    .fn<BookingAutomationAccess["readRuns"]>()
    .mockResolvedValueOnce({ ok: true, value: { ...runs, runs: [conflictingRun, failed] } })
    .mockResolvedValue({ ok: true, value: { ...runs, runs: [delivered] } });
  const retry = vi
    .fn<BookingAutomationAccess["retry"]>()
    .mockRejectedValueOnce(new Error("Retry acknowledgement lost"))
    .mockResolvedValueOnce({ ok: true, value: delivered });
  render(panel(site, connection({ readRuns, retry })));
  const link = await screen.findByRole("link", { name: failed.title });
  expect(link).toHaveAttribute("href", `/assets/bookings?bookingId=${bookingId}&demo=automations`);
  fireEvent.click(screen.getByRole("button", { name: "Retry failed attempt" }));
  await screen.findByText("The request could not be confirmed. Try again.");
  fireEvent.click(screen.getByRole("button", { name: "Retry failed attempt" }));
  await screen.findByText("Retry requested.");
  expect(
    await screen.findByText("Delivered", { selector: "[data-slot=badge]" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Automation run history" })).toHaveFocus();
  expect(retry).toHaveBeenCalledTimes(2);
  const first = retry.mock.calls[0]?.[0];
  expect(first).toMatchObject({ siteId: site.id, runId, failureId, requestId: expect.any(String) });
  expect(retry.mock.calls[1]?.[0]).toEqual(first);
  expect(screen.queryByRole("button", { name: "Retry failed attempt" })).not.toBeInTheDocument();
});

it("discards a pending cursor read when the selected scope changes and keeps archived managers read-only", async () => {
  const site = demoSite();
  let resolveOld: (result: Awaited<ReturnType<BookingAutomationAccess["readRuns"]>>) => void =
    () => {};
  const pendingOld = new Promise<Awaited<ReturnType<BookingAutomationAccess["readRuns"]>>>(
    (resolve) => {
      resolveOld = resolve;
    },
  );
  const readRuns = vi
    .fn<BookingAutomationAccess["readRuns"]>()
    .mockResolvedValueOnce({ ok: true, value: { ...runs, nextCursor: "next-cursor" } })
    .mockReturnValueOnce(pendingOld);
  const view = render(panel(site, connection({ readRuns })));
  fireEvent.click(await screen.findByRole("button", { name: "Next page" }));
  expect(readRuns.mock.calls[1]?.[0]).toMatchObject({ siteId: site.id, cursor: "next-cursor" });
  expect(screen.queryByRole("link", { name: failed.title })).not.toBeInTheDocument();

  const updated = { ...failed, id: "new-scope", title: "Current scope only" };
  const access = connection({
    readRuns: () => Promise.resolve({ ok: true, value: { ...runs, runs: [updated] } }),
  });
  view.rerender(panel({ ...site, archived: true }, access));
  expect(await screen.findByRole("link", { name: updated.title })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Save notification rules" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Retry failed attempt" })).not.toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: "Return overdue" })).toBeDisabled();
  const staleSignal = readRuns.mock.calls[1]?.[1];
  expect(staleSignal?.aborted).toBe(true);
  await act(async () => {
    resolveOld({ ok: true, value: runs });
    await pendingOld;
  });
  expect(screen.queryByRole("link", { name: failed.title })).not.toBeInTheDocument();

  view.rerender(panel({ ...site, role: "base" }, access));
  expect(screen.queryByRole("region", { name: "Booking notifications" })).not.toBeInTheDocument();
});
