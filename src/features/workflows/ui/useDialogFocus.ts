"use client";

import { useRef } from "react";

export function focusAvailable(target: HTMLElement | null) {
  if (target?.isConnected === true && !target.matches(":disabled,[aria-disabled=true]")) {
    target.focus();
    return document.activeElement === target;
  }
  return false;
}

export function useDialogFocus() {
  const target = useRef<HTMLElement | null>(null);
  return {
    remember(element: HTMLElement | null) {
      target.current = element;
    },
    restore(event: Event, fallback: HTMLElement | null = null) {
      // These dialogs have several possible openers, so Radix has no single DialogTrigger.
      event.preventDefault();
      if (target.current !== null && !focusAvailable(target.current)) focusAvailable(fallback);
    },
  };
}
