"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MailboxConnectionError, MailboxConnectionResult } from "./types";

const MAILBOX_REFRESH_INTERVAL_MS = 10_000;

export function useMailboxRefresh<T>(
  load: (signal: AbortSignal) => Promise<MailboxConnectionResult<T>>,
  accept: (value: T) => void,
) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MailboxConnectionError | null>(null);
  const current = useRef<AbortController | null>(null);
  const refresh = useCallback(
    async (explicit: boolean) => {
      if (
        !explicit &&
        (current.current !== null ||
          document.visibilityState !== "visible" ||
          document.querySelector('[role="dialog"], [role="alertdialog"]') !== null)
      )
        return;
      current.current?.abort();
      const controller = new AbortController();
      current.current = controller;
      if (explicit) {
        setBusy(true);
        setError(null);
      }
      try {
        const result = await load(controller.signal);
        if (controller.signal.aborted) return;
        if (result.ok) {
          accept(result.value);
          setError(null);
        } else setError(result.error);
      } catch {
        if (!controller.signal.aborted) setError("network");
      } finally {
        if (current.current === controller) {
          current.current = null;
          setBusy(false);
        }
      }
    },
    [load, accept],
  );
  useEffect(() => {
    const interval = window.setInterval(() => void refresh(false), MAILBOX_REFRESH_INTERVAL_MS);
    function visibilityChanged() {
      if (document.visibilityState === "visible") void refresh(false);
      else {
        current.current?.abort();
        current.current = null;
        setBusy(false);
      }
    }
    document.addEventListener("visibilitychange", visibilityChanged);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", visibilityChanged);
      current.current?.abort();
      current.current = null;
    };
  }, [refresh]);
  return { busy, error, reload: useCallback(() => void refresh(true), [refresh]) };
}
