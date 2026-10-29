import type { ColumnDef } from "@/components/data-table/columnModel";
import { createAppTranslator } from "@/features/i18n/catalog";
import type { Locale } from "@/features/i18n/registry";
import type { PersonSortField } from "./schemas";

// People list column catalog. Name is pinned (row link + avatar) and sortable; Email is sortable.
// Org/Phone are plain. Closed deals (won+lost count) rides on a batched deal-count join in the list
// query (see listPeople/peopleDealCounts). Customize columns adds reorder + hide. Offering Owner /
// Last activity as NEW columns needs a users/activities join (CL3 follow-on), not in the catalog yet.
export interface PeopleColumn extends ColumnDef {
  sortField?: PersonSortField;
}

const english = createAppTranslator("en", "contacts");

export const PEOPLE_COLUMNS: readonly PeopleColumn[] = [
  {
    key: "name",
    header: english("name"),
    pinned: true,
    defaultVisible: true,
    sortField: "name",
  },
  { key: "org", header: english("organizationText"), defaultVisible: true },
  {
    key: "email",
    header: english("email"),
    defaultVisible: true,
    sortField: "primaryEmail",
  },
  { key: "phone", header: english("phone"), defaultVisible: true },
  { key: "closedDeals", header: english("closedDeals"), defaultVisible: true },
] as const;

export function peopleColumns(locale: Locale = "en") {
  const t = createAppTranslator(locale, "contacts");
  const labels = {
    name: "name",
    org: "organizationText",
    email: "email",
    phone: "phone",
    closedDeals: "closedDeals",
  } as const;
  return PEOPLE_COLUMNS.map((column) => ({
    ...column,
    header: t(labels[column.key as keyof typeof labels]),
  }));
}
