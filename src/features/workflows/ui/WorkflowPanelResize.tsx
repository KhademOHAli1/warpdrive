"use client";

import type { KeyboardEvent, PointerEvent } from "react";
import { useEffect, useRef } from "react";
import { useAppTranslations, useLocale } from "@/features/i18n/LocaleProvider";
import { directionForLocale } from "@/features/i18n/registry";
import styles from "./workflowEditorSplit.module.css";

export const workflowPanelWidth = { min: 320, initial: 400, max: 600 } as const;

function clamp(width: number) {
  return Math.max(workflowPanelWidth.min, Math.min(workflowPanelWidth.max, Math.round(width)));
}

interface Drag {
  pointerId: number;
  startX: number;
  startWidth: number;
  moved: boolean;
  target: HTMLHRElement;
  abort: AbortController;
}

interface Props {
  panelId: string;
  width: number;
  onWidthChange: (width: number) => void;
  onResizingChange: (resizing: boolean) => void;
  onClose: () => void;
}

function keyWidth(key: string, width: number, direction: -1 | 1): number | undefined {
  switch (key) {
    case "ArrowLeft":
      return width - 10 * direction;
    case "ArrowRight":
      return width + 10 * direction;
    case "Home":
      return workflowPanelWidth.min;
    case "End":
      return workflowPanelWidth.max;
    default:
      return undefined;
  }
}

export function WorkflowPanelResize({
  panelId,
  width,
  onWidthChange,
  onResizingChange,
  onClose,
}: Props) {
  const t = useAppTranslations("workflows");
  const locale = useLocale();
  const direction = directionForLocale(locale) === "rtl" ? 1 : -1;
  const drag = useRef<Drag | null>(null);
  useEffect(() => () => drag.current?.abort.abort(), []);

  function finish(cancelled: boolean) {
    const active = drag.current;
    if (active === null) return;
    drag.current = null;
    active.abort.abort();
    if (active.target.hasPointerCapture?.(active.pointerId)) {
      active.target.releasePointerCapture(active.pointerId);
    }
    if (active.moved) {
      if (cancelled) onWidthChange(active.startWidth);
      onResizingChange(false);
    } else if (!cancelled) onClose();
  }

  function start(event: PointerEvent<HTMLHRElement>) {
    if (event.button !== 0 || drag.current !== null) return;
    const abort = new AbortController();
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: width,
      moved: false,
      target: event.currentTarget,
      abort,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    window.addEventListener(
      "keydown",
      (event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        finish(true);
      },
      { signal: abort.signal, capture: true },
    );
  }
  function move(event: PointerEvent<HTMLHRElement>) {
    const active = drag.current;
    if (active?.pointerId !== event.pointerId) return;
    const displacement = event.clientX - active.startX;
    if (!active.moved) {
      if (Math.abs(displacement) <= 5) return;
      active.moved = true;
      onResizingChange(true);
    }
    onWidthChange(clamp(active.startWidth + displacement * direction));
  }
  function end(event: PointerEvent<HTMLHRElement>) {
    if (drag.current?.pointerId !== event.pointerId) return;
    const cancelled = event.type !== "pointerup";
    if (!cancelled) move(event);
    finish(cancelled);
  }
  function keyboard(event: KeyboardEvent<HTMLHRElement>) {
    if (drag.current !== null || event.altKey || event.ctrlKey || event.metaKey) return;
    const next = keyWidth(event.key, width, direction);
    if (next === undefined && event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.stopPropagation();
    if (next === undefined) {
      if (!event.repeat) onClose();
    } else onWidthChange(clamp(next));
  }

  return (
    <hr
      tabIndex={0}
      aria-label={t("resizeSidePanel")}
      aria-controls={panelId}
      aria-keyshortcuts="Enter Space"
      aria-orientation="vertical"
      aria-valuemin={workflowPanelWidth.min}
      aria-valuemax={workflowPanelWidth.max}
      aria-valuenow={width}
      className={styles.resize}
      onKeyDown={keyboard}
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
    />
  );
}
