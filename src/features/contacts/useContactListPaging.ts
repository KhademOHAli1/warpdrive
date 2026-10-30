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
}: {
  initial: Row[];
  initialTotal: number;
  initialRefLabels: CustomFieldRefLabels;
  fetchPage: (offset: number) => Promise<ContactListPage<Row>>;
  reloadError: string;
  moreError: string;
}) {
  const [rows, setRows] = useState(initial);
  const [total, setTotal] = useState(initialTotal);
  const [refLabels, setRefLabels] = useState(initialRefLabels);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const revision = useRef(0);
  const inFlight = useRef(false);
  const seed = useRef(initial);
  const latestFetch = useRef(fetchPage);
  const invalidate = useCallback(() => {
    ++revision.current;
  }, []);

  useEffect(() => {
    latestFetch.current = fetchPage;
    invalidate();
    return invalidate;
  }, [fetchPage, invalidate]);

  const request = useCallback(
    async (offset: number, append: boolean): Promise<void> => {
      const current = ++revision.current;
      inFlight.current = true;
      setLoading(true);
      setError(null);
      try {
        const page = await fetchPage(offset);
        if (current !== revision.current || fetchPage !== latestFetch.current) return;
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
        if (current === revision.current) setError(append ? moreError : reloadError);
      } finally {
        if (current === revision.current) {
          inFlight.current = false;
          setLoading(false);
        }
      }
    },
    [fetchPage, moreError, reloadError],
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

  return { rows, total, refLabels, loading, error, setError, reload, loadMore };
}
