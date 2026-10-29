import type { ColumnDef } from "@/components/data-table/columnModel";
import { createAppTranslator } from "@/features/i18n/catalog";
import type { Locale } from "@/features/i18n/registry";
import type { OrgSortField } from "./schemas";

// Organizations list column catalog. Name is pinned (row link + avatar) and sortable; Address /
// People count / Deal count are plain, all default-visible. Customize columns adds reorder + hide.
export interface OrgColumn extends ColumnDef {
  sortField?: OrgSortField;
}

const english = createAppTranslator("en", "contacts");

export const ORG_COLUMNS: readonly OrgColumn[] = [
  {
    key: "name",
    header: english("name"),
    pinned: true,
    defaultVisible: true,
    sortField: "name",
  },
  { key: "address", header: english("address"), defaultVisible: true },
  // Pipedrive's org list defaults to Name / Address / Closed deals / Open deals. People count is
  // a WD extra, retained but opt-in (Customize columns) so the default matches PD.
  { key: "closedDeals", header: english("closedDeals"), defaultVisible: true },
  { key: "openDeals", header: english("openDeals"), defaultVisible: true },
  { key: "peopleCount", header: english("people"), defaultVisible: false },
] as const;

export function orgColumns(locale: Locale = "en") {
  const t = createAppTranslator(locale, "contacts");
  const labels = {
    name: "name",
    address: "address",
    closedDeals: "closedDeals",
    openDeals: "openDeals",
    peopleCount: "people",
  } as const;
  return ORG_COLUMNS.map((column) => ({
    ...column,
    header: t(labels[column.key as keyof typeof labels]),
  }));
}
