"use client";
import { type PointerEvent, type RefObject, useRef, useState } from "react";
import { selectionBounds, selectionMinute } from "./calendarSelection";

export function useCalendarSelection(
  column: RefObject<HTMLDivElement | null>,
  onSelect: (start: number, end: number) => void,
) {
  const active = useRef<{ id: number; start: number } | null>(null);
  const ignoreClick = useRef(false);
  const [preview, setPreview] = useState<{ start: number; end: number } | null>(null);
  function minute(event: PointerEvent<HTMLButtonElement>): number {
    return selectionMinute(event.clientY, column.current?.getBoundingClientRect().top ?? 0);
  }
  function finish(event: PointerEvent<HTMLButtonElement>): void {
    const drag = active.current;
    if (drag === null || drag.id !== event.pointerId) return;
    const last = minute(event);
    const bounds = selectionBounds(drag.start, last);
    active.current = null;
    setPreview(null);
    ignoreClick.current = true;
    event.currentTarget.releasePointerCapture(event.pointerId);
    // A click keeps the familiar one-hour default; dragging chooses the highlighted interval.
    onSelect(bounds.start, last === drag.start ? Math.min(1440, bounds.start + 60) : bounds.end);
  }
  return {
    preview,
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0 || event.pointerType === "touch") return;
      const start = minute(event);
      active.current = { id: event.pointerId, start };
      event.currentTarget.setPointerCapture(event.pointerId);
      setPreview(selectionBounds(start, start));
    },
    onPointerMove: (event: PointerEvent<HTMLButtonElement>) => {
      const drag = active.current;
      if (drag !== null && drag.id === event.pointerId)
        setPreview(selectionBounds(drag.start, minute(event)));
    },
    onPointerUp: finish,
    onPointerCancel: () => {
      active.current = null;
      setPreview(null);
    },
    consumeClick: (detail: number) => {
      const ignored = ignoreClick.current && detail !== 0;
      ignoreClick.current = false;
      return ignored;
    },
  };
}
