"use client";
import { useEffect } from "react";
import { isShortcutSuppressed, isTypingTarget } from "@/features/shortcuts/shortcutTarget";

// Opens the command palette on Cmd/Ctrl+K or "/" when not focused in a text field.
export function useSearchHotkey(onOpen: () => void): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isShortcutSuppressed(e)) return;
      const meta = e.metaKey || e.ctrlKey;
      const isSlash = e.key === "/" && !meta && !isTypingTarget(e.target);
      if ((meta && e.key.toLowerCase() === "k") || isSlash) {
        e.preventDefault();
        onOpen();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onOpen]);
}
