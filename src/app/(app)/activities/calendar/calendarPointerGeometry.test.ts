// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CalendarPoint, CalendarSelection } from "@/features/activities/calendarGesture";
import { calendarPreviewBoxes } from "./calendarPointerGeometry";

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

const roots: HTMLElement[] = [];
let heightDescriptor: PropertyDescriptor | undefined;

beforeEach(() => {
  heightDescriptor = Object.getOwnPropertyDescriptor(window, "innerHeight");
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 700 });
});

afterEach(() => {
  for (const element of roots) element.remove();
  roots.length = 0;
  vi.restoreAllMocks();
  if (heightDescriptor === undefined) Reflect.deleteProperty(window, "innerHeight");
  else Object.defineProperty(window, "innerHeight", heightDescriptor);
});

function root(): HTMLElement {
  const element = document.createElement("section");
  document.body.append(element);
  roots.push(element);
  return element;
}

function element(parent: HTMLElement, box: Box): HTMLDivElement {
  const node = document.createElement("div");
  vi.spyOn(node, "getBoundingClientRect").mockReturnValue(
    new DOMRect(box.left, box.top, box.width, box.height),
  );
  parent.append(node);
  return node;
}

function surface(
  parent: HTMLElement,
  date: string,
  box: Box,
  kind: CalendarPoint["kind"] = "time",
) {
  const node = element(parent, box);
  node.dataset.calendarSurface = kind;
  node.dataset.calendarDate = date;
  return node;
}

function scroll(parent: HTMLElement, box: Box): HTMLElement {
  const node = element(parent, box);
  node.dataset.agendaScroll = "";
  return node;
}

function sticky(parent: HTMLElement, box: Box): HTMLElement {
  const node = element(parent, box);
  node.className = "sticky";
  return node;
}

function timed(time: string, endTime: string): CalendarSelection {
  return { date: "2026-11-05", time, endDate: "2026-11-05", endTime };
}

it("clips a timed preview below the pinned day/all-day header", () => {
  const host = root();
  const agenda = scroll(host, { left: 100, top: 100, width: 200, height: 500 });
  sticky(agenda, { left: 100, top: 100, width: 200, height: 80 });
  surface(agenda, "2026-11-05", { left: 100, top: -300, width: 200, height: 1152 });
  expect(calendarPreviewBoxes(timed("09:00", "11:00"), host, "time")).toEqual([
    { key: "2026-11-05", left: 101, top: 180, width: 198, height: 48 },
  ]);
});

it("clips timed selections at the agenda scroll box's lower edge", () => {
  const host = root();
  const agenda = scroll(host, { left: 100, top: 100, width: 200, height: 500 });
  sticky(agenda, { left: 100, top: 100, width: 200, height: 60 });
  surface(agenda, "2026-11-05", { left: 100, top: 100, width: 200, height: 1152 });
  expect(calendarPreviewBoxes(timed("09:00", "13:00"), host, "time")).toEqual([
    { key: "2026-11-05", left: 101, top: 532, width: 198, height: 68 },
  ]);
});

it("clips at the viewport when there is no nested agenda scroll box", () => {
  const host = root();
  surface(host, "2026-11-05", { left: 20, top: 650, width: 200, height: 1440 });
  expect(calendarPreviewBoxes(timed("00:00", "01:00"), host, "time")).toEqual([
    { key: "2026-11-05", left: 21, top: 650, width: 198, height: 50 },
  ]);
});

it("intersects the viewport with a scroll box that extends below it", () => {
  const host = root();
  const agenda = scroll(host, { left: 20, top: 650, width: 200, height: 300 });
  surface(agenda, "2026-11-05", { left: 20, top: 650, width: 200, height: 1440 });
  expect(calendarPreviewBoxes(timed("00:00", "01:00"), host, "time")).toEqual([
    { key: "2026-11-05", left: 21, top: 650, width: 198, height: 50 },
  ]);
});

it("honors the agenda's upper clip even without a sticky header", () => {
  const host = root();
  const agenda = scroll(host, { left: 100, top: 100, width: 200, height: 500 });
  surface(agenda, "2026-11-05", { left: 100, top: 0, width: 200, height: 1440 });
  expect(calendarPreviewBoxes(timed("01:00", "03:00"), host, "time")).toEqual([
    { key: "2026-11-05", left: 101, top: 100, width: 198, height: 80 },
  ]);
});

it("keeps the all-day lane visible inside the sticky header instead of clipping at its bottom", () => {
  const host = root();
  const agenda = scroll(host, { left: 100, top: 100, width: 200, height: 500 });
  const header = sticky(agenda, { left: 100, top: 100, width: 200, height: 100 });
  surface(header, "2026-11-05", { left: 100, top: 140, width: 200, height: 40 }, "date");
  expect(calendarPreviewBoxes({ date: "2026-11-05", endDate: "2026-11-05" }, host, "date")).toEqual(
    [{ key: "2026-11-05", left: 101, top: 140, width: 198, height: 40 }],
  );
});

it("includes both endpoint dates and uses actual cell positions in an RTL layout", () => {
  const host = root();
  host.dir = "rtl";
  for (const [date, left] of [
    ["2026-11-04", 700],
    ["2026-11-05", 500],
    ["2026-11-06", 300],
    ["2026-11-07", 100],
    ["2026-11-08", 0],
  ] as const) {
    surface(host, date, { left, top: 200, width: 180, height: 96 }, "date");
  }
  surface(host, "2026-11-06", { left: 10, top: 0, width: 100, height: 1440 });
  expect(calendarPreviewBoxes({ date: "2026-11-05", endDate: "2026-11-07" }, host, "date")).toEqual(
    [
      { key: "2026-11-05", left: 501, top: 200, width: 178, height: 96 },
      { key: "2026-11-06", left: 301, top: 200, width: 178, height: 96 },
      { key: "2026-11-07", left: 101, top: 200, width: 178, height: 96 },
    ],
  );
});

it("returns no boxes without a root, without surfaces, or without matching dates", () => {
  expect(calendarPreviewBoxes(timed("09:00", "10:00"), null, "time")).toEqual([]);
  const host = root();
  expect(calendarPreviewBoxes(timed("09:00", "10:00"), host, "time")).toEqual([]);
  surface(host, "2026-11-06", { left: 20, top: 100, width: 200, height: 1152 });
  expect(calendarPreviewBoxes(timed("09:00", "10:00"), host, "time")).toEqual([]);
});

it("omits fully offscreen and zero-height surfaces", () => {
  const host = root();
  surface(host, "2026-11-05", { left: 20, top: -200, width: 200, height: 100 });
  surface(host, "2026-11-05", { left: 20, top: 800, width: 200, height: 100 });
  surface(host, "2026-11-05", { left: 20, top: 200, width: 200, height: 0 });
  const agenda = scroll(host, { left: 20, top: 800, width: 200, height: 300 });
  surface(agenda, "2026-11-05", { left: 20, top: 800, width: 200, height: 1440 });
  expect(calendarPreviewBoxes(timed("00:00", "01:00"), host, "time")).toEqual([]);
});
