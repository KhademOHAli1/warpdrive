import type { ColumnDef } from "@/components/data-table/columnModel";
import { createAppTranslator } from "@/features/i18n/catalog";
import type { Locale } from "@/features/i18n/registry";

// The deals List-view column catalog. Title is pinned (row link). To match Pipedrive's default
// deals list (CV-4 / collection-views spec B4), Contact person, Next activity, and Expected close
// date are default-visible alongside Org/Value/Stage/Owner. Their data rides on the board card
// (personName / nextActivityAt / expectedCloseDate), so no extra query beyond one added SELECT.
export function dealListColumns(locale: Locale = "en"): readonly ColumnDef[] {
  const t = createAppTranslator(locale, "sales");
  return [
    { key: "title", header: t("fields.title"), pinned: true, defaultVisible: true },
    { key: "org", header: t("fields.org"), defaultVisible: true },
    { key: "value", header: t("fields.value"), defaultVisible: true },
    { key: "stage", header: t("fields.stage"), defaultVisible: true },
    { key: "owner", header: t("fields.owner"), defaultVisible: true },
    { key: "person", header: t("fields.person"), defaultVisible: true },
    { key: "expectedCloseDate", header: t("fields.expectedCloseDate"), defaultVisible: true },
    { key: "nextActivity", header: t("fields.nextActivity"), defaultVisible: true },
    { key: "status", header: t("fields.status") },
  ];
}

export const DEAL_LIST_COLUMNS = dealListColumns();
