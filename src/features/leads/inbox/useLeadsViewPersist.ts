"use client";
import { useEffect, useRef } from "react";
import { PERSIST_DEBOUNCE_MS } from "@/constants/leads";
import { setLeadsViewAction } from "@/features/identity/preferencesActions";
import { readCsrfToken } from "@/utils/csrfCookie";
import type { LeadSort } from "./useLeadSort";

// Best-effort, debounced persistence of the Leads Inbox column order + sort to user_preferences.
// Skips the initial mount (server already seeded the view), and flushes a still-pending write on
// unmount so a reorder/sort change made just before navigating away is not silently dropped.
export function useLeadsViewPersist(
  order: readonly string[],
  sort: LeadSort,
  { enabled = true }: { enabled?: boolean } = {},
): void {
  const mounted = useRef(false);
  const wasEnabled = useRef(enabled);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPersist = useRef<{ columns: string[]; sort: LeadSort } | null>(null);

  useEffect(() => {
    if (!enabled) {
      if (persistTimer.current !== null) clearTimeout(persistTimer.current);
      persistTimer.current = null;
      pendingPersist.current = null;
      wasEnabled.current = false;
      return;
    }
    if (!wasEnabled.current) {
      wasEnabled.current = true;
      mounted.current = true;
      return;
    }
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const payload = { columns: [...order], sort };
    pendingPersist.current = payload;
    if (persistTimer.current !== null) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      pendingPersist.current = null;
      void setLeadsViewAction(payload, readCsrfToken());
    }, PERSIST_DEBOUNCE_MS);
  }, [order, sort, enabled]);

  useEffect(() => {
    return () => {
      if (persistTimer.current !== null) clearTimeout(persistTimer.current);
      if (pendingPersist.current !== null) {
        void setLeadsViewAction(pendingPersist.current, readCsrfToken());
        pendingPersist.current = null;
      }
    };
  }, []);
}
