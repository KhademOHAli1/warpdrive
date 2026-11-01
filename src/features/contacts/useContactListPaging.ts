"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type CustomFieldRefLabels,
  EMPTY_REF_LABELS,
  mergeRefLabels,
} from "@/features/custom-fields/refLabelsContext";

export interface ContactListPage<Row> {
  rows: Row[];
  total: number;
  refLabels?: CustomFieldRefLabels;
}

// Both directories share request ordering and refresh behavior. A late search response must
// never replace a newer result, and returning from contact creation must refresh the current view.
export function useContactListPaging<Row extends { id: string }>({
  initial,
  initialTotal,
  initialRefLabels,
  fetchPage,
  reloadError,
  moreError,
  enabled = true,
}: {
  initial: Row[];
  initialTotal: number;
  initialRefLabels: CustomFieldRefLabels;
  fetchPage: (offset: number) => Promise<ContactListPage<Row>>;
  reloadError: string;
  moreError: string;
  enabled?: boolean;
}) {
  const [rows, setRows] = useState(initial);
  const [deliveredFetch, setDeliveredFetch] = useState(() => fetchPage);
  const [total, setTotal] = useState(initialTotal);
  const [refLabels, setRefLabels] = useState(initialRefLabels);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const revision = useRef(0);
  const enabledRef = useRef(enabled);
  const inFlight = useRef(false);
  const seed = useRef(initial);
  const latestFetch = useRef(fetchPage);
  const stillEnabled = useCallback(() => enabledRef.current, []);
  const invalidate = useCallback(() => {
    ++revision.current;
  }, []);

  useEffect(() => {
    latestFetch.current = fetchPage;
    enabledRef.current = enabled;
    invalidate();
    return invalidate;
  }, [fetchPage, enabled, invalidate]);

  const request = useCallback(
    async (offset: number, append: boolean): Promise<void> => {
      if (!enabled || !stillEnabled()) return;
      const current = ++revision.current;
      inFlight.current = true;
      setLoading(true);
      setError(null);
      try {
        const page = await fetchPage(offset);
        if (!stillEnabled() || current !== revision.current || fetchPage !== latestFetch.current)
          return;
        setDeliveredFetch(() => fetchPage);
        setRows((previous) =>
          append
            ? [...new Map([...previous, ...page.rows].map((row) => [row.id, row])).values()]
            : page.rows,
        );
        setTotal(page.total);
        setRefLabels((previous) =>
          append
            ? mergeRefLabels(previous, page.refLabels ?? EMPTY_REF_LABELS)
            : (page.refLabels ?? EMPTY_REF_LABELS),
        );
      } catch {
        if (stillEnabled() && current === revision.current)
          setError(append ? moreError : reloadError);
      } finally {
        if (current === revision.current) {
          inFlight.current = false;
          setLoading(false);
        }
      }
    },
    [enabled, fetchPage, moreError, reloadError, stillEnabled],
  );

  const reload = useCallback(() => request(0, false), [request]);
  const loadMore = useCallback(async (): Promise<void> => {
    if (!inFlight.current) await request(rows.length, true);
  }, [request, rows.length]);

  useEffect(() => {
    if (seed.current === initial) return;
    seed.current = initial;
    void reload();
  }, [initial, reload]);

  const currentQuery = enabled && deliveredFetch === fetchPage;
  return {
    rows: currentQuery ? rows : [],
    total: currentQuery ? total : 0,
    refLabels: currentQuery ? refLabels : EMPTY_REF_LABELS,
    loading: enabled && (loading || (!currentQuery && error === null)),
    error: enabled ? error : null,
    setError,
    reload,
    loadMore,
  };
}
