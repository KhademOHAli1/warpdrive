"use client";
import { startTransition, useEffect, useRef, useState } from "react";
import { readCsrfToken } from "@/utils/csrfCookie";
import { disconnectGoogleCalendarAction } from "./connectionActions";
import { requestGoogleCalendarConnection } from "./connectionRequest";

export function useCalendarConnection(refresh: () => Promise<boolean>) {
  const [pending, setPending] = useState<string | null>(null);
  const [confirmedDisconnects, setConfirmedDisconnects] = useState<ReadonlyMap<string, symbol>>(
    () => new Map<string, symbol>(),
  );
  const [feedback, setFeedback] = useState<
    "startFailed" | "disconnectFailed" | "disconnected" | null
  >(null);
  const active = useRef(false);
  const mounted = useRef(true);
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current?.abort();
    };
  }, []);
  function begin(key: string): boolean {
    if (active.current) return false;
    active.current = true;
    setPending(key);
    setFeedback(null);
    return true;
  }
  function finish() {
    active.current = false;
    if (mounted.current) setPending(null);
  }
  async function refreshConfirmations(confirmations: ReadonlyMap<string, symbol>): Promise<void> {
    try {
      const refreshed = await refresh();
      if (!refreshed || !mounted.current) return;
      setConfirmedDisconnects((current) => {
        const next = new Map(current);
        for (const [accountId, receipt] of confirmations) {
          // An older read cannot clear a more recent local disconnect acknowledgment.
          if (next.get(accountId) === receipt) next.delete(accountId);
        }
        return next.size === current.size ? current : next;
      });
    } catch {
      console.warn("calendar account refresh failed");
    }
  }
  async function connect(accountId?: string): Promise<void> {
    if (!begin(accountId ?? "new")) return;
    request.current = new AbortController();
    const signal = AbortSignal.any([request.current.signal, AbortSignal.timeout(15_000)]);
    try {
      const result = await requestGoogleCalendarConnection(signal, accountId);
      if (!mounted.current) return;
      if (result.ok) window.location.assign(result.value);
      else setFeedback("startFailed");
    } catch {
      if (mounted.current) setFeedback("startFailed");
    } finally {
      finish();
    }
  }
  function disconnect(accountId: string): void {
    if (!begin(accountId)) return;
    startTransition(async () => {
      try {
        const result = await disconnectGoogleCalendarAction(accountId, readCsrfToken());
        if (!mounted.current) return;
        if (!result.ok) {
          setFeedback("disconnectFailed");
          return;
        }
        const receipt = Symbol("confirmed calendar disconnect");
        setConfirmedDisconnects((current) => new Map(current).set(accountId, receipt));
        setFeedback("disconnected");
        // Keep the confirmed local state until an explicitly post-commit read succeeds.
        void refreshConfirmations(new Map([[accountId, receipt]]));
      } catch {
        if (mounted.current) setFeedback("disconnectFailed");
      } finally {
        finish();
      }
    });
  }
  function runCatalog(accountId: string, work: () => Promise<void>): void {
    if (!begin(`catalog:${accountId}`)) return;
    startTransition(async () => {
      try {
        await work();
      } finally {
        finish();
      }
    });
  }
  return {
    pending,
    feedback,
    connect,
    disconnect,
    runCatalog,
    isLocallyDisconnected: (accountId: string) => confirmedDisconnects.has(accountId),
    refreshAccounts: () => refreshConfirmations(confirmedDisconnects),
  };
}
