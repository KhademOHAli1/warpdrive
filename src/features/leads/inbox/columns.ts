import type { ColumnDef } from "@/components/data-table/columnModel";
import { createAppTranslator } from "@/features/i18n/catalog";
import type { Locale } from "@/features/i18n/registry";
import type { LeadSortField } from "../schemas";

export interface LeadColumn extends ColumnDef {
  sortField?: LeadSortField;
}

const english = createAppTranslator("en", "leads");

export const LEAD_COLUMNS: readonly LeadColumn[] = [
  {
    key: "title",
    header: english("title"),
    sortField: "title",
    pinned: true,
    defaultVisible: true,
  },
  {
    key: "nextActivity",
    header: english("nextActivity"),
    sortField: "nextActivityAt",
    defaultVisible: true,
  },
  { key: "labels", header: english("labels"), sortField: "label", defaultVisible: true },
  {
    key: "sourceOrigin",
    header: english("sourceOrigin"),
    sortField: "sourceOrigin",
    defaultVisible: true,
  },
  { key: "value", header: english("value"), sortField: "value", defaultVisible: false },
  {
    key: "createdAt",
    header: english("leadCreated"),
    sortField: "createdAt",
    defaultVisible: true,
  },
  { key: "owner", header: english("owner"), sortField: "ownerName", defaultVisible: true },
] as const;

export function leadColumns(locale: Locale = "en") {
  const t = createAppTranslator(locale, "leads");
  const labels = {
    title: "title",
    nextActivity: "nextActivity",
    labels: "labels",
    sourceOrigin: "sourceOrigin",
    value: "value",
    createdAt: "leadCreated",
    owner: "owner",
  } as const;
  return LEAD_COLUMNS.map((column) => ({
    ...column,
    header: t(labels[column.key as keyof typeof labels]),
  }));
}
