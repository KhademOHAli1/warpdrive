"use client";

import { type RefObject, useLayoutEffect, useState } from "react";
import type { CalendarPoint, CalendarSelection } from "@/features/activities/calendarGesture";
import { CalendarGesturePreview } from "./CalendarGesturePreview";
import { type CalendarPreviewBox, calendarPreviewBoxes } from "./calendarPointerGeometry";

export function CalendarSavingPreview({
  selection,
  subject,
  kind,
  root,
}: {
  selection: CalendarSelection;
  subject: string;
  kind: CalendarPoint["kind"];
  root: RefObject<HTMLElement | null>;
}): React.ReactNode {
  const [boxes, setBoxes] = useState<CalendarPreviewBox[]>([]);

  useLayoutEffect(() => {
    const measure = (): void => {
      const next = calendarPreviewBoxes(selection, root.current, kind);
      setBoxes((current) => {
        const unchanged =
          current.length === next.length &&
          next.every((box, index) => {
            const previous = current[index];
            return (
              previous !== undefined &&
              previous.key === box.key &&
              previous.left === box.left &&
              previous.top === box.top &&
              previous.width === box.width &&
              previous.height === box.height
            );
          });
        return unchanged ? current : next;
      });
    };
    measure();
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    if (root.current !== null) observer?.observe(root.current);
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, [selection, kind, root]);

  return <CalendarGesturePreview preview={{ selection, subject, boxes }} saving />;
}
