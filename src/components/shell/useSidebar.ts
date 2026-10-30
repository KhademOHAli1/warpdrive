"use client";

import { useEffect, useState } from "react";
import { OPEN_SIDEBAR_EVENT } from "@/constants/nav";
import { isOverlayOpen, isTypingTarget } from "@/features/shortcuts/shortcutTarget";
import { readSidebarPreference, writeSidebarPreference } from "./sidebarPreference";

const DESKTOP_QUERY = "(min-width: 1024px)";

export function useSidebar(initialExpanded: boolean) {
  const [expanded, setExpanded] = useState(initialExpanded);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const preference = readSidebarPreference();
    if (preference !== null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reconcile the server-readable preference after hydration
      setExpanded(preference);
    }
    if (typeof window.matchMedia !== "function") {
      if (preference === null) setExpanded(true);
      return;
    }
    const media = window.matchMedia(DESKTOP_QUERY);
    const apply = (): void => {
      if (readSidebarPreference() === null) setExpanded(media.matches);
      if (media.matches) setMobileOpen(false);
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    const openMobile = (): void => setMobileOpen(true);
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key !== "[" && event.key !== "]") return;
      if (isTypingTarget(event.target) || isOverlayOpen(document)) return;
      event.preventDefault();
      const next = event.key === "[";
      writeSidebarPreference(next);
      setExpanded(next);
    };
    window.addEventListener(OPEN_SIDEBAR_EVENT, openMobile);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener(OPEN_SIDEBAR_EVENT, openMobile);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  function toggle(): void {
    const next = !expanded;
    writeSidebarPreference(next);
    setExpanded(next);
  }

  return { expanded, toggle, mobileOpen, setMobileOpen };
}
