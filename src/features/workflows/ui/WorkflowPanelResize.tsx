"use client";

import type { KeyboardEvent, PointerEvent } from "react";
import { useRef } from "react";
import { useAppTranslations, useLocale } from "@/features/i18n/LocaleProvider";
import { directionForLocale } from "@/features/i18n/registry";
import styles from "./workflowEditor.module.css";

export const workflowPanelWidth = { min: 320, initial: 400, max: 600 } as const;

function clamp(width: number) {
  return Math.max(workflowPanelWidth.min, Math.min(workflowPanelWidth.max, Math.round(width)));
}

interface Drag {
  pointerId: number;
  startX: number;
  startWidth: number;
  moved: boolean;
}

interface Props {
  width: number;
  onWidthChange: (width: number) => void;
  onClose: () => void;
}

function keyWidth(key: string, width: number, direction: -1 | 1): number | undefined {
  switch (key) {
    case "ArrowLeft":
      return width - 20 * direction;
    case "ArrowRight":
      return width + 20 * direction;
    case "Home":
      return workflowPanelWidth.min;
    case "End":
      return workflowPanelWidth.max;
    default:
      return undefined;
  }
}

export function WorkflowPanelResize({ width, onWidthChange, onClose }: Props) {
  const t = useAppTranslations("workflows");
  const locale = useLocale();
  const direction = directionForLocale(locale) === "rtl" ? 1 : -1;
  const drag = useRef<Drag | null>(null);

  function start(event: PointerEvent<HTMLHRElement>) {
    if (event.button !== 0 || drag.current !== null) return;
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: width,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent<HTMLHRElement>) {
    const active = drag.current;
    if (active?.pointerId !== event.pointerId) return;
    const displacement = event.clientX - active.startX;
    if (Math.abs(displacement) >= 3) active.moved = true;
    if (active.moved) onWidthChange(clamp(active.startWidth + displacement * direction));
  }
  function end(event: PointerEvent<HTMLHRElement>) {
    const active = drag.current;
    if (active?.pointerId !== event.pointerId) return;
    drag.current = null;
    if (event.type === "pointerup" && !active.moved) onClose();
  }
  function keyboard(event: KeyboardEvent<HTMLHRElement>) {
    const next = keyWidth(event.key, width, direction);
    if (next === undefined && event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    if (next === undefined) onClose();
    else onWidthChange(clamp(next));
  }

  return (
    <hr
      tabIndex={0}
      aria-label={t("resizeSidePanel")}
      aria-orientation="vertical"
      aria-valuemin={workflowPanelWidth.min}
      aria-valuemax={workflowPanelWidth.max}
      aria-valuenow={width}
      className={styles.panelResize}
      onKeyDown={keyboard}
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
    />
  );
}
