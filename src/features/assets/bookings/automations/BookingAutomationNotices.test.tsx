/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { BookingAutomationNotices } from "./BookingAutomationNotices";
import type { BookingAutomationAccess, BookingAutomationNotice } from "./contracts";

const bookingId = "361eba2b-7365-4e4c-a306-000000000001";
const otherBooking = "361eba2b-7365-4e4c-a306-000000000002";
const deliveredAt = "2026-11-21T10:00:00.000Z";
const notice: BookingAutomationNotice = {
  id: "notice-one",
  bookingId,
  trigger: "request_sent_back",
  deliveredAt,
  dueAt: null,
};

afterEach(cleanup);

test("renders notices only for the exact selected booking", async () => {
  const read = vi.fn<BookingAutomationAccess["readNotices"]>().mockResolvedValue({
    ok: true,
    value: [
      notice,
      { ...notice, id: "notice-other", bookingId: otherBooking, trigger: "pickup_expired" },
    ],
  });
  render(<BookingAutomationNotices bookingId={bookingId} version={1} timeZone="UTC" read={read} />);
  await screen.findByText("Changes requested");
  expect(screen.queryByText("Pickup missed")).toBeNull();
  expect(read.mock.calls[0]?.[0]).toBe(bookingId);
});

test("clears the old result while rechecking access after window focus", async () => {
  const read = vi
    .fn<BookingAutomationAccess["readNotices"]>()
    .mockResolvedValueOnce({ ok: true, value: [notice] })
    .mockResolvedValueOnce({ ok: false, error: "unavailable" });
  render(<BookingAutomationNotices bookingId={bookingId} version={1} timeZone="UTC" read={read} />);
  await screen.findByText("Changes requested");
  fireEvent.focus(window);
  expect(screen.queryByText("Changes requested")).toBeNull();
  await screen.findByText("Booking notices are unavailable.");
  expect(read).toHaveBeenCalledTimes(2);
});
