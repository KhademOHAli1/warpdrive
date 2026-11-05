"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
export function useStudioLeaveGuard(dirty: boolean, pending: boolean) {
  const router = useRouter();
  const [destination, setDestination] = useState<string | null>(null);
  useEffect(() => {
    if (!dirty && !pending) return;
    const beforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    const click = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey ||
        !(event.target instanceof Element)
      )
        return;
      const link = event.target.closest("a[href]");
      if (
        !(link instanceof HTMLAnchorElement) ||
        link.hasAttribute("download") ||
        (link.target !== "" && link.target !== "_self")
      )
        return;
      const url = new URL(link.href, window.location.href);
      if (
        url.origin !== window.location.origin ||
        (url.pathname === window.location.pathname && url.search === window.location.search)
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!pending) setDestination(`${url.pathname}${url.search}${url.hash}`);
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", click, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", click, true);
    };
  }, [dirty, pending]);
  return {
    open: destination !== null,
    cancel: () => setDestination(null),
    leave: () => {
      if (destination !== null && !pending) {
        const href = destination;
        setDestination(null);
        router.push(href);
      }
    },
  };
}
