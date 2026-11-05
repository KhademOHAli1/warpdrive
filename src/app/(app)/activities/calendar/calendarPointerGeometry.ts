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

export function agendaInlineBounds(scroll: HTMLElement): { left: number; right: number } {
  const viewportLeft = scroll.getBoundingClientRect().left + scroll.clientLeft;
  const left = Math.max(0, viewportLeft);
  const right = Math.min(window.innerWidth, viewportLeft + scroll.clientWidth);
  const gutter = scroll.querySelector<HTMLElement>("[data-agenda-gutter]")?.getBoundingClientRect();
  if (gutter === undefined) return { left, right };
  return getComputedStyle(scroll).direction === "rtl"
    ? { left, right: Math.min(right, gutter.left) }
    : { left: Math.max(left, gutter.right), right };
}

function previewBox(
  surface: HTMLElement,
  date: string,
  segment: NonNullable<ReturnType<typeof selectionSegments>>,
  kind: CalendarPoint["kind"],
): CalendarPreviewBox | null {
  const rect = surface.getBoundingClientRect();
  const timed = kind === "time";
  const scroll = surface.closest<HTMLElement>("[data-agenda-scroll]");
  const clip = scroll?.getBoundingClientRect();
  const inline = scroll === null ? rect : agendaInlineBounds(scroll);
  const left = Math.max(rect.left + 1, inline.left);
  const right = Math.min(rect.right - 1, inline.right);
  const pinned = scroll?.querySelector<HTMLElement>(".sticky")?.getBoundingClientRect().bottom ?? 0;
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
  if (right <= left || bottom <= top) return null;
  return { key: date, left, top, width: right - left, height: Math.max(4, bottom - top) };
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
    const box = previewBox(surface, date, segment, kind);
    if (box !== null) boxes.push(box);
  }
  return boxes;
}
