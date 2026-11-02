"use client";
import type React from "react";
import { useEffect } from "react";
import { NAV_ITEMS } from "@/constants/nav";
import { navHrefForKey } from "./navShortcut";
import { isOverlayOpen, isTypingTarget } from "./shortcutTarget";

// App-wide keyboard shortcuts that belong to no single component (Pipedrive parity): the number row
// jumps to a primary nav item. Mounted once in the app layout; renders nothing.
export function GlobalShortcuts(): React.ReactNode {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (e.isComposing || e.keyCode === 229 || e.defaultPrevented) return;
      if (isTypingTarget(e.target) || isOverlayOpen(document)) return;
      const href = navHrefForKey(e.key, NAV_ITEMS);
      if (href === null) return;
      e.preventDefault();
      // Activate the rendered link so capture-phase navigation guards can cancel it.
      document.querySelector<HTMLAnchorElement>(`#primary-navigation a[href="${href}"]`)?.click();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return null;
}
