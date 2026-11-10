"use client";
import { useEffect, useRef, useState } from "react";
export function useCalendarNavigationGuard(dirty: boolean, pending: boolean) {
  const [open, setOpen] = useState(false);
  const next = useRef<(() => void) | null>(null);
  useEffect(() => {
    function unload(event: BeforeUnloadEvent): void {
      if (dirty || pending) {
        event.preventDefault();
        event.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, [dirty, pending]);
  return {
    open,
    setOpen,
    navigate: (action: () => void) => {
      if (pending) return;
      if (dirty) {
        next.current = action;
        setOpen(true);
      } else action();
    },
    confirm: () => {
      const action = next.current;
      next.current = null;
      action?.();
    },
  };
}
