import {
  type CalendarPoint,
  type CalendarSelection,
  selectionSegments,
} from "@/features/activities/calendarGesture";

export interface CalendarPreviewBox {
  key: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

export function calendarPreviewBoxes(
  selection: CalendarSelection,
  root: HTMLElement | null,
  kind: CalendarPoint["kind"],
): CalendarPreviewBox[] {
  if (root === null) return [];
  const boxes: CalendarPreviewBox[] = [];
  for (const surface of root.querySelectorAll<HTMLElement>("[data-calendar-surface]")) {
    const date = surface.dataset.calendarDate;
    if (date === undefined || surface.dataset.calendarSurface !== kind) continue;
    const segment = selectionSegments(selection, date);
    if (segment === null) continue;
    const rect = surface.getBoundingClientRect();
    const timed = kind === "time";
    const scroll = surface.closest<HTMLElement>("[data-agenda-scroll]");
    const clip = scroll?.getBoundingClientRect();
    const pinned =
      scroll?.querySelector<HTMLElement>(".sticky")?.getBoundingClientRect().bottom ?? 0;
    const top = Math.max(
      timed ? rect.top + (rect.height * segment.startMinute) / 1440 : rect.top,
      0,
      clip?.top ?? 0,
      timed ? pinned : 0,
    );
    const bottom = Math.min(
      timed ? rect.top + (rect.height * segment.endMinute) / 1440 : rect.bottom,
      clip?.bottom ?? window.innerHeight,
      window.innerHeight,
    );
    if (bottom <= top) continue;
    boxes.push({
      key: date,
      left: rect.left + 1,
      top,
      width: rect.width - 2,
      height: Math.max(4, bottom - top),
    });
  }
  return boxes;
}
