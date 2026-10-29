"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ColumnSort } from "@/components/data-table/useColumnSort";
import {
  type CustomFieldRefLabels,
  mergeRefLabels,
} from "@/features/custom-fields/refLabelsContext";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { trpc } from "@/lib/trpc-client";
import type { ContactFilterDefinition } from "./contactFilterConfig";
import { type PeopleListRow, type RawPersonRow, toRow } from "./PeopleTable";
import type { PersonSortField } from "./schemas";

const PAGE_SIZE = 50;

export interface PeopleListPaging {
  rows: PeopleListRow[];
  total: number;
  refLabels: CustomFieldRefLabels;
  loading: boolean;
  error: string | null;
  setError: (error: string | null) => void;
  loadMore: () => Promise<void>;
  reload: () => Promise<void>;
}

export function usePeopleListPaging(opts: {
  initial: PeopleListRow[];
  initialTotal: number;
  initialRefLabels: CustomFieldRefLabels;
  orgNames: Record<string, string>;
  sort: ColumnSort<PersonSortField>;
  filter: ContactFilterDefinition | null;
}): PeopleListPaging {
  const t = useAppTranslations("contacts");
  const { initial, initialTotal, initialRefLabels, orgNames, sort, filter } = opts;
  const utils = trpc.useUtils();
  const utilsRef = useRef(utils);
  useEffect(() => {
    utilsRef.current = utils;
  });
  const [rows, setRows] = useState<PeopleListRow[]>(initial);
  const [total, setTotal] = useState(initialTotal);
  const [refLabels, setRefLabels] = useState<CustomFieldRefLabels>(initialRefLabels);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPage = useCallback(
    async (
      offset: number,
    ): Promise<{ rows: PeopleListRow[]; total: number; refLabels: CustomFieldRefLabels }> => {
      const page = await utilsRef.current.client.contacts.listPeople.query({
        offset,
        limit: PAGE_SIZE,
        sort,
        filter: filter ?? undefined,
      });
      return {
        rows: page.rows.map((r) => toRow(r as RawPersonRow, orgNames)),
        total: page.total,
        refLabels: page.refLabels,
      };
    },
    [sort, orgNames, filter],
  );

  const loadMore = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const page = await fetchPage(rows.length);
      setRows((prev) => [...prev, ...page.rows]);
      setTotal(page.total);
      setRefLabels((prev) => mergeRefLabels(prev, page.refLabels));
    } catch {
      setError(t("couldnTLoadMorePeoplePleaseTryAgain"));
    } finally {
      setLoading(false);
    }
  }, [fetchPage, rows.length, t]);

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const page = await fetchPage(0);
      setRows(page.rows);
      setTotal(page.total);
      setRefLabels(page.refLabels);
    } catch {
      setError(t("couldnTLoadPeoplePleaseTryAgain"));
    } finally {
      setLoading(false);
    }
  }, [fetchPage, t]);

  return { rows, total, refLabels, loading, error, setError, loadMore, reload };
}
