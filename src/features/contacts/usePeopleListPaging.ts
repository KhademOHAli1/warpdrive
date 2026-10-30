"use client";
import { useCallback, useEffect, useRef } from "react";
import type { ColumnSort } from "@/components/data-table/useColumnSort";
import type { CustomFieldRefLabels } from "@/features/custom-fields/refLabelsContext";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { trpc } from "@/lib/trpc-client";
import type { ContactFilterDefinition } from "./contactFilterConfig";
import { type PeopleListRow, type RawPersonRow, toRow } from "./PeopleTable";
import type { PersonSortField } from "./schemas";
import { useContactListPaging } from "./useContactListPaging";

export function usePeopleListPaging(opts: {
  initial: PeopleListRow[];
  initialTotal: number;
  initialRefLabels: CustomFieldRefLabels;
  orgNames: Record<string, string>;
  sort: ColumnSort<PersonSortField>;
  filter: ContactFilterDefinition | null;
  search?: string;
}) {
  const t = useAppTranslations("contacts");
  const { initial, initialTotal, initialRefLabels, orgNames, sort, filter, search = "" } = opts;
  const utils = trpc.useUtils();
  const utilsRef = useRef(utils);
  useEffect(() => {
    utilsRef.current = utils;
  });
  const fetchPage = useCallback(
    async (offset: number) => {
      const page = await utilsRef.current.client.contacts.listPeople.query({
        offset,
        limit: 50,
        sort,
        filter: filter ?? undefined,
        search: search || undefined,
      });
      return {
        rows: page.rows.map((row) => toRow(row as RawPersonRow, orgNames)),
        total: page.total,
        refLabels: page.refLabels,
      };
    },
    [sort, orgNames, filter, search],
  );
  return useContactListPaging({
    initial,
    initialTotal,
    initialRefLabels,
    fetchPage,
    reloadError: t("couldnTLoadPeoplePleaseTryAgain"),
    moreError: t("couldnTLoadMorePeoplePleaseTryAgain"),
  });
}
