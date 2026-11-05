// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarActivity } from "@/features/activities/calendar";
import type { CalendarMoveTarget, CalendarSelection } from "@/features/activities/calendarGesture";
import type { CalendarResizeTarget } from "@/features/activities/calendarResize";
import { useCalendarPointer } from "./useCalendarPointer";

class TestPointerEvent extends MouseEvent {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly isPrimary: boolean;

  constructor(type: string, options: PointerEventInit = {}) {
    super(type, options);
    this.pointerId = options.pointerId ?? 1;
    this.pointerType = options.pointerType ?? "mouse";
    this.isPrimary = options.isPrimary ?? true;
  }
}

const ACTIVITY: CalendarActivity = {
  id: "meeting",
  subject: "Meeting",
  dueAt: new Date("2026-11-05T09:07:00Z"),
  allDay: false,
  durationMinutes: 60,
  typeKey: "meeting",
  done: false,
  dealId: null,
  personId: null,
  orgId: null,
  overdue: false,
  ownerName: null,
};
const ACTIVITIES = [ACTIVITY];
let originalHitTest: PropertyDescriptor | undefined;
let captures = new WeakMap<Element, Set<number>>();
let frameId = 0;

function rect(element: HTMLElement): DOMRect {
  switch (element.dataset.testid ?? "") {
    case "time-first":
      return new DOMRect(0, 100, 100, 1152);
    case "time-second":
      return new DOMRect(100, 100, 100, 1152);
    case "date-first":
      return new DOMRect(200, 100, 100, 96);
    case "date-second":
      return new DOMRect(300, 100, 100, 96);
    case "outside":
      return new DOMRect(400, 100, 100, 1152);
    default:
      return new DOMRect(0, 0, 400, 1400);
  }
}

function hitTest(x: number, y: number): Element | null {
  if (y < 100 || y >= 1252 || x < 0) return null;
  if (x < 100) return screen.getByTestId("time-first");
  if (x < 200) return screen.getByTestId("time-second");
  if (x < 300 && y < 196) return screen.getByTestId("date-first");
  if (x < 400 && y < 196) return screen.getByTestId("date-second");
  return screen.getByTestId("outside");
}

beforeEach(() => {
  captures = new WeakMap();
  frameId = 0;
  vi.stubGlobal("PointerEvent", TestPointerEvent);
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => ++frameId),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    return rect(this);
  });
  vi.spyOn(Element.prototype, "setPointerCapture").mockImplementation(function (this: Element, id) {
    captures.set(this, new Set([id]));
  });
  vi.spyOn(Element.prototype, "hasPointerCapture").mockImplementation(function (this: Element, id) {
    return captures.get(this)?.has(id) === true;
  });
  vi.spyOn(Element.prototype, "releasePointerCapture").mockImplementation(function (
    this: Element,
    id,
  ) {
    captures.get(this)?.delete(id);
  });
  originalHitTest = Object.getOwnPropertyDescriptor(document, "elementFromPoint");
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: vi.fn(hitTest),
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (originalHitTest === undefined) Reflect.deleteProperty(document, "elementFromPoint");
  else Object.defineProperty(document, "elementFromPoint", originalHitTest);
});

interface HarnessProps {
  scopeKey?: string;
  disabled?: boolean;
  onCreate: (selection: CalendarSelection) => void;
  onMove: (activity: CalendarActivity, target: CalendarMoveTarget) => void;
  onResize: (
    activity: CalendarActivity,
    target: CalendarResizeTarget,
    selection: CalendarSelection,
  ) => void;
  onClick: () => void;
}

function Harness({
  scopeKey = "week",
  disabled = false,
  onCreate,
  onMove,
  onResize,
  onClick,
}: HarnessProps) {
  const { root, preview, bindings } = useCalendarPointer({
    scopeKey,
    disabled,
    activities: ACTIVITIES,
    timeZone: "UTC",
    onCreate,
    onMove,
    onResize,
  });
  const selection = preview?.selection;
  return (
    <>
      <section ref={root} {...bindings} data-testid="root">
        <div data-testid="time-first" data-calendar-surface="time" data-calendar-date="2026-11-05">
          <button type="button" data-hour="9" onClick={onClick}>
            First slot
          </button>
          <button type="button" data-calendar-event-id="meeting" onClick={onClick}>
            Meeting chip
            <span data-testid="resize-end" data-calendar-resize-edge="end" />
          </button>
        </div>
        <div data-testid="time-second" data-calendar-surface="time" data-calendar-date="2026-11-06">
          <button type="button" data-hour="9" onClick={onClick}>
            Second slot
          </button>
        </div>
        <div data-testid="date-first" data-calendar-surface="date" data-calendar-date="2026-11-05">
          <a href="/activities/calendar?view=day&d=2026-11-05" onClick={onClick}>
            Open day
          </a>
          <div data-testid="linked-chip" data-calendar-event-id="meeting">
            <a href="/activities/list?activity=meeting">Linked meeting</a>
          </div>
          <button type="button" onClick={onClick}>
            New event
          </button>
        </div>
        <div
          data-testid="date-second"
          data-calendar-surface="date"
          data-calendar-date="2026-11-08"
        />
        <output data-testid="preview">
          {selection === undefined
            ? "none"
            : `${selection.date}|${selection.time ?? ""}|${selection.endDate}|${selection.endTime ?? ""}`}
        </output>
      </section>
      <div data-testid="outside" data-calendar-surface="time" data-calendar-date="2026-11-10" />
    </>
  );
}

function fixture(props: Partial<HarnessProps> = {}) {
  const callbacks = { onCreate: vi.fn(), onMove: vi.fn(), onResize: vi.fn(), onClick: vi.fn() };
  const view = render(<Harness {...callbacks} {...props} />);
  return { ...callbacks, ...view };
}

function pointer(
  element: Element,
  type: "down" | "move" | "up",
  x: number,
  minute: number,
  options: PointerEventInit = {},
): boolean {
  return fireEvent(
    element,
    new TestPointerEvent(`pointer${type}`, {
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: type === "up" ? 0 : 1,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
      clientX: x,
      clientY: 100 + minute * 0.8,
      ...options,
    }),
  );
}

function beginDraw() {
  const slot = screen.getByRole("button", { name: "First slot" });
  pointer(slot, "down", 50, 540);
  pointer(slot, "move", 50, 585);
  return slot;
}

function touchEvent(element: Element, type: "touchstart" | "touchmove", contacts = 1): boolean {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "touches", { value: { length: contacts } });
  return fireEvent(element, event);
}

const TOUCH = { pointerType: "touch" } as const;

function waitForHold(): void {
  act(() => {
    vi.advanceTimersByTime(450);
  });
}

describe("calendar pointer selection", () => {
  it.each([
    [540, 585],
    [585, 540],
  ])("draws a quarter-hour range from minute %s to %s", (first, last) => {
    const { onCreate, onClick } = fixture();
    const slot = screen.getByRole("button", { name: "First slot" });
    pointer(slot, "down", 50, first);
    pointer(slot, "move", 50, last);
    expect(screen.getByTestId("preview")).toHaveTextContent("2026-11-05|09:00|2026-11-05|10:00");
    pointer(slot, "up", 50, last);
    expect(onCreate).toHaveBeenCalledOnce();
    expect(onCreate).toHaveBeenCalledWith({
      date: "2026-11-05",
      time: "09:00",
      endDate: "2026-11-05",
      endTime: "10:00",
    });
    expect(screen.getByTestId("preview")).toHaveTextContent("none");
    fireEvent.click(slot, { detail: 1 });
    expect(onClick).not.toHaveBeenCalled();
    fireEvent.click(slot, { detail: 0 });
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("keeps ordinary clicks when movement does not cross the drag threshold", () => {
    const { onCreate, onClick } = fixture();
    const slot = screen.getByRole("button", { name: "First slot" });
    pointer(slot, "down", 50, 540);
    pointer(slot, "move", 52, 542);
    pointer(slot, "up", 52, 542);
    fireEvent.click(slot, { detail: 1 });
    expect(onCreate).not.toHaveBeenCalled();
    expect(onClick).toHaveBeenCalledOnce();
    expect(requestAnimationFrame).not.toHaveBeenCalled();
    expect(slot.hasPointerCapture(1)).toBe(false);
  });

  it("preserves the grab offset when moving an event into another day", () => {
    const { onMove, onCreate, onClick } = fixture();
    const chip = screen.getByRole("button", { name: "Meeting chip" });
    pointer(chip, "down", 50, 555);
    pointer(chip, "move", 150, 600);
    expect(chip).toHaveAttribute("data-calendar-dragging", "true");
    pointer(chip, "up", 150, 600);
    expect(onMove).toHaveBeenCalledOnce();
    expect(onMove).toHaveBeenCalledWith(ACTIVITY, { date: "2026-11-06", time: "09:52" });
    expect(onCreate).not.toHaveBeenCalled();
    expect(chip).not.toHaveAttribute("data-calendar-dragging");
    fireEvent.click(chip, { detail: 1 });
    expect(onClick).not.toHaveBeenCalled();
  });

  it("resizes a timed event from a grip and suppresses the trailing chip click", () => {
    const { onMove, onResize, onClick } = fixture();
    const grip = screen.getByTestId("resize-end");
    pointer(grip, "down", 50, 607);
    pointer(grip, "move", 50, 660);
    expect(screen.getByTestId("preview")).toHaveTextContent("2026-11-05|09:07|2026-11-05|11:00");
    pointer(grip, "up", 50, 660);
    fireEvent.click(grip, { detail: 1 });
    expect(onResize).toHaveBeenCalledExactlyOnceWith(
      ACTIVITY,
      { edge: "end", date: "2026-11-05", time: "11:00" },
      { date: "2026-11-05", time: "09:07", endDate: "2026-11-05", endTime: "11:00" },
    );
    expect(onMove).not.toHaveBeenCalled();
    expect(onClick).not.toHaveBeenCalled();
  });

  it("draws an inclusive date range without making it a timed event", () => {
    const { onCreate } = fixture();
    const start = screen.getByTestId("date-first");
    pointer(start, "down", 225, 20);
    pointer(start, "move", 325, 20);
    pointer(start, "up", 325, 20);
    expect(onCreate).toHaveBeenCalledOnce();
    expect(onCreate).toHaveBeenCalledWith({ date: "2026-11-05", endDate: "2026-11-08" });
  });

  it("does not draw through a month date link or its explicit creation button", () => {
    const { onCreate, onClick } = fixture();
    for (const control of [
      screen.getByRole("link", { name: "Open day" }),
      screen.getByRole("button", { name: "New event" }),
    ]) {
      pointer(control, "down", 225, 20);
      pointer(control, "move", 325, 20);
      pointer(control, "up", 325, 20);
      fireEvent.click(control, { detail: 1 });
    }
    expect(onCreate).not.toHaveBeenCalled();
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it("does not create an event when a linked event background is clicked", () => {
    const { onCreate } = fixture();
    fireEvent.click(screen.getByTestId("linked-chip"), { detail: 1 });
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("ignores a touch drag so scrolling and normal taps remain available", () => {
    const { onCreate, onMove, onClick } = fixture();
    const slot = screen.getByRole("button", { name: "First slot" });
    expect(pointer(slot, "down", 50, 540, { pointerType: "touch" })).toBe(true);
    pointer(slot, "move", 50, 585, { pointerType: "touch" });
    pointer(slot, "up", 50, 585, { pointerType: "touch" });
    fireEvent.click(slot, { detail: 1 });
    expect(onCreate).not.toHaveBeenCalled();
    expect(onMove).not.toHaveBeenCalled();
    expect(onClick).toHaveBeenCalledOnce();
    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });

  it("rejects mixed targets and dates belonging to another calendar root", () => {
    const { onCreate } = fixture();
    const slot = screen.getByRole("button", { name: "First slot" });
    pointer(slot, "down", 50, 540);
    pointer(slot, "move", 225, 20);
    pointer(slot, "up", 225, 20);
    expect(onCreate).not.toHaveBeenCalled();
    pointer(slot, "down", 50, 540);
    pointer(slot, "move", 450, 585);
    pointer(slot, "up", 450, 585);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("rechecks the release location instead of committing the last valid hover", () => {
    const { onCreate } = fixture();
    const slot = beginDraw();
    pointer(slot, "up", 450, 585);
    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.getByTestId("preview")).toHaveTextContent("none");
  });
});

describe("calendar touch move", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("keeps quick event taps and disarms a hold when native scrolling begins", () => {
    const { onClick, onMove } = fixture();
    const chip = screen.getByRole("button", { name: "Meeting chip" });
    expect(pointer(chip, "down", 50, 555, TOUCH)).toBe(true);
    expect(pointer(chip, "up", 50, 555, TOUCH)).toBe(true);
    fireEvent.click(chip, { detail: 1 });
    expect(onClick).toHaveBeenCalledOnce();
    expect(fireEvent.contextMenu(chip)).toBe(true);

    pointer(chip, "down", 50, 555, TOUCH);
    expect(touchEvent(chip, "touchmove")).toBe(true);
    waitForHold();
    pointer(chip, "up", 150, 600, TOUCH);
    expect(chip.hasPointerCapture(1)).toBe(false);
    expect(screen.getByTestId("preview")).toHaveTextContent("none");
    expect(onMove).not.toHaveBeenCalled();
  });

  it("previews a held event, blocks native panning and drops once", () => {
    const { onCreate, onClick, onMove, onResize } = fixture();
    const chip = screen.getByRole("button", { name: "Meeting chip" });
    const grip = screen.getByTestId("resize-end");
    pointer(grip, "down", 50, 555, TOUCH);
    expect(screen.getByTestId("preview")).toHaveTextContent("none");
    waitForHold();
    expect(chip).toHaveAttribute("data-calendar-dragging", "true");
    expect(screen.getByTestId("preview")).toHaveTextContent("2026-11-05|09:07|2026-11-05|10:07");
    expect(fireEvent.contextMenu(chip)).toBe(false);
    expect(touchEvent(chip, "touchmove")).toBe(false);
    pointer(chip, "move", 150, 600, TOUCH);
    pointer(chip, "up", 150, 600, TOUCH);
    pointer(chip, "up", 150, 600, TOUCH);
    fireEvent.click(chip, { detail: 1 });
    expect(onMove).toHaveBeenCalledExactlyOnceWith(ACTIVITY, { date: "2026-11-06", time: "09:52" });
    expect(onResize).not.toHaveBeenCalled();
    expect(onCreate).not.toHaveBeenCalled();
    expect(onClick).not.toHaveBeenCalled();
    expect(screen.getByTestId("preview")).toHaveTextContent("none");
  });

  it.each(["motion", "multi-touch", "lostpointercapture", "pointercancel", "scope", "overlay"])(
    "cancels a pending hold on %s",
    (reason) => {
      const view = fixture();
      const chip = screen.getByRole("button", { name: "Meeting chip" });
      pointer(chip, "down", 50, 555, TOUCH);
      const overlay = document.createElement("div");
      overlay.setAttribute("role", "dialog");
      try {
        if (reason === "motion") pointer(chip, "move", 50, 575, TOUCH);
        else if (reason === "multi-touch") touchEvent(document.body, "touchstart", 2);
        else if (reason === "scope") view.rerender(<Harness {...view} scopeKey="next-week" />);
        else if (reason === "overlay") document.body.append(overlay);
        else fireEvent(chip, new TestPointerEvent(reason, { pointerId: 1, bubbles: true }));
        waitForHold();
        expect(screen.getByTestId("preview")).toHaveTextContent("none");
        expect(chip.hasPointerCapture(1)).toBe(false);
        pointer(chip, "up", 150, 600, TOUCH);
        expect(view.onMove).not.toHaveBeenCalled();
      } finally {
        overlay.remove();
      }
    },
  );
});

describe("calendar pointer cancellation", () => {
  it.each(["Escape", "blur", "pointercancel", "lostpointercapture"])(
    "cancels on %s and releases owned resources",
    (reason) => {
      const { onCreate, onMove } = fixture();
      const slot = beginDraw();
      expect(screen.getByTestId("preview")).not.toHaveTextContent("none");
      if (reason === "Escape") fireEvent.keyDown(window, { key: "Escape" });
      else if (reason === "blur") fireEvent(window, new Event("blur"));
      else fireEvent(slot, new TestPointerEvent(reason, { pointerId: 1, bubbles: true }));
      pointer(slot, "up", 50, 585);
      expect(onCreate).not.toHaveBeenCalled();
      expect(onMove).not.toHaveBeenCalled();
      expect(screen.getByTestId("preview")).toHaveTextContent("none");
      expect(cancelAnimationFrame).toHaveBeenCalled();
      expect(slot.hasPointerCapture(1)).toBe(false);
    },
  );

  it("cancels an in-flight gesture when the displayed scope changes", () => {
    const view = fixture();
    const slot = beginDraw();
    view.rerender(<Harness {...view} scopeKey="next-week" />);
    pointer(slot, "up", 50, 585);
    expect(view.onCreate).not.toHaveBeenCalled();
    expect(screen.getByTestId("preview")).toHaveTextContent("none");
  });

  it("does not start gestures while the calendar is disabled", () => {
    const { onCreate } = fixture({ disabled: true });
    const slot = beginDraw();
    pointer(slot, "up", 50, 585);
    expect(onCreate).not.toHaveBeenCalled();
    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });

  it("cancels when interaction becomes disabled during the drag", () => {
    const view = fixture();
    const slot = beginDraw();
    view.rerender(<Harness {...view} disabled />);
    pointer(slot, "up", 50, 585);
    expect(view.onCreate).not.toHaveBeenCalled();
    expect(screen.getByTestId("preview")).toHaveTextContent("none");
  });

  it("releases capture and animation work when unmounted", () => {
    const remove = vi.spyOn(window, "removeEventListener");
    const view = fixture();
    const slot = beginDraw();
    view.unmount();
    expect(slot.hasPointerCapture(1)).toBe(false);
    expect(cancelAnimationFrame).toHaveBeenCalled();
    expect(remove).toHaveBeenCalledWith("keydown", expect.any(Function), true);
    expect(remove).toHaveBeenCalledWith("blur", expect.any(Function));
  });
});
