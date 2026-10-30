"use client";
import { useCallback, useEffect, useRef } from "react";
import type { ColumnSort } from "@/components/data-table/useColumnSort";
import type { CustomFieldRefLabels } from "@/features/custom-fields/refLabelsContext";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { trpc } from "@/lib/trpc-client";
import type { ContactFilterDefinition } from "./contactFilterConfig";
import type { OrgsListRow } from "./OrgsTable";
import type { OrgSortField } from "./schemas";
import { useContactListPaging } from "./useContactListPaging";

export function useOrgsListPaging({
  initial,
  initialTotal,
  initialRefLabels,
  sort,
  filter,
  search,
}: {
  initial: OrgsListRow[];
  initialTotal: number;
  initialRefLabels: CustomFieldRefLabels;
  sort: ColumnSort<OrgSortField>;
  filter: ContactFilterDefinition | null;
  search: string;
}) {
  const t = useAppTranslations("contacts");
  const utils = trpc.useUtils();
  const utilsRef = useRef(utils);
  useEffect(() => {
    utilsRef.current = utils;
  });
  const fetchPage = useCallback(
    async (offset: number) => {
      const page = await utilsRef.current.client.contacts.listOrgs.query({
        offset,
        limit: 50,
        sort,
        filter: filter ?? undefined,
        search: search || undefined,
      });
      return {
        rows: page.rows.map((row) => ({
          id: row.id,
          name: row.name,
          address: row.address,
          customFields: row.customFields,
          peopleCount: row.peopleCount,
          closedDeals: row.closedDeals,
          openDeals: row.openDeals,
        })),
        total: page.total,
        refLabels: page.refLabels,
      };
    },
    [sort, filter, search],
  );
  return useContactListPaging({
    initial,
    initialTotal,
    initialRefLabels,
    fetchPage,
    reloadError: t("couldnTLoadOrganizationsPleaseTryAgain"),
    moreError: t("couldnTLoadMoreOrganizationsPleaseTryAgain"),
  });
}
