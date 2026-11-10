// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { AgendaDayColumn } from "./AgendaDayColumn";
import { AllDayLane } from "./AllDayLane";

afterEach(cleanup);
beforeAll(() => {
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});

it("creates one exact interval after a pointer drag, including the following native click", () => {
  const onOpenInterval = vi.fn();
  const onOpenSlot = vi.fn();
  render(
    <AgendaDayColumn
      iso="2027-03-21"
      dayLabel="March 21"
      items={[]}
      onOpenActivity={vi.fn()}
      onOpenSlot={onOpenSlot}
      onOpenInterval={onOpenInterval}
    />,
  );
  const slot = screen.getByRole("button", { name: "Add activity on 2027-03-21 at 09:00" });
  fireEvent.pointerDown(slot, { pointerId: 1, pointerType: "mouse", button: 0, clientY: 444 });
  fireEvent.pointerMove(slot, { pointerId: 1, pointerType: "mouse", clientY: 480 });
  fireEvent.pointerUp(slot, { pointerId: 1, pointerType: "mouse", clientY: 480 });
  fireEvent.click(slot, { detail: 1 });
  expect(onOpenInterval).toHaveBeenCalledExactlyOnceWith("2027-03-21", 555, 615);
  expect(onOpenSlot).not.toHaveBeenCalled();
});
it("keeps touch scrolling available and exposes an all-day creation target even when empty", () => {
  const onCreate = vi.fn();
  render(
    <AllDayLane
      dayLabel="March 21"
      items={[]}
      rows={1}
      onOpenActivity={vi.fn()}
      onCreate={onCreate}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Create an all-day event on March 21" }));
  expect(onCreate).toHaveBeenCalledTimes(1);
});

it("preserves the full duration of a reverse drag", () => {
  const onOpenInterval = vi.fn();
  render(
    <AgendaDayColumn
      iso="2027-03-21"
      dayLabel="March 21"
      items={[]}
      onOpenActivity={vi.fn()}
      onOpenSlot={vi.fn()}
      onOpenInterval={onOpenInterval}
    />,
  );
  const slot = screen.getByRole("button", { name: "Add activity on 2027-03-21 at 11:00" });
  fireEvent.pointerDown(slot, { pointerId: 1, pointerType: "mouse", button: 0, clientY: 528 });
  fireEvent.pointerUp(slot, { pointerId: 1, pointerType: "mouse", clientY: 444 });
  expect(onOpenInterval).toHaveBeenCalledExactlyOnceWith("2027-03-21", 555, 675);
});
