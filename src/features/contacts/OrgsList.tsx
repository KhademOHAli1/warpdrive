"use client";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { BulkActionBar } from "@/components/data-table/BulkActionBar";
import { BulkDeleteButton } from "@/components/data-table/BulkDeleteButton";
import { ColumnsMenu } from "@/components/data-table/ColumnsMenu";
import { type ColumnSort, useColumnSort } from "@/components/data-table/useColumnSort";
import { useColumns } from "@/components/data-table/useColumns";
import { usePersistColumns } from "@/components/data-table/usePersistColumns";
import { useRowSelection } from "@/components/data-table/useRowSelection";
import { Button } from "@/components/ui/Button";
import { DEFAULT_BASE_CURRENCY } from "@/constants/currency";
import { customFieldColumns } from "@/features/custom-fields/listColumns";
import {
  type CustomFieldRefLabels,
  CustomFieldRefLabelsProvider,
  EMPTY_REF_LABELS,
} from "@/features/custom-fields/refLabelsContext";
import { useAppTranslations, useLocale } from "@/features/i18n/LocaleProvider";
import type { SavedView } from "@/features/saved-filters/savedView";
import type { CustomFieldDef } from "@/types/customFields";
import { readCsrfToken } from "@/utils/csrfCookie";
import { deleteOrgAction } from "./actions";
import { BulkMergeDialog } from "./BulkMergeDialog";
import {
  ContactDirectoryCriteria,
  ContactDirectoryEmptyState,
  ContactDirectoryToolbar,
} from "./ContactDirectorySurface";
import type { ContactFilterDefinition } from "./contactFilterConfig";
import { OrgsListToolbar } from "./OrgsListToolbar";
import { type OrgsListRow, OrgsTable } from "./OrgsTable";
import { orgColumns } from "./orgColumns";
import type { OrgSortField } from "./schemas";
import { useContactSearch } from "./useContactSearch";
import { useOrgsListPaging } from "./useOrgsListPaging";

// Stable module reference: passed as useColumnSort's fallback, so `effective` only changes
// reference when the sort state itself changes (not on every OrgsList re-render).
const DEFAULT_SORT: ColumnSort<OrgSortField> = { field: "name", dir: "asc" };

export interface OrgsListProps {
  rows: OrgsListRow[];
  total: number;
  // Seeded from user_preferences.ui.orgsView (server); falls back to catalog defaults.
  initialColumns?: string[];
  customFieldDefs?: CustomFieldDef[];
  baseCurrency?: string;
  refLabels?: CustomFieldRefLabels;
  emptyAction?: React.ReactNode;
}

// Organizations list for the Contacts nav. Client-side "Load more" pages through the rest
// of the visible set via contacts.listOrgs; the first page is seeded server-side. Row
// selection, column sort, and bulk delete adopt the shared Wave 1 data-table hooks, mirroring
// PeopleList (Task 19) applied to orgs.
export function OrgsList({
  rows: initial,
  total: initialTotal,
  initialColumns,
  customFieldDefs = [],
  baseCurrency = DEFAULT_BASE_CURRENCY,
  refLabels: initialRefLabels = EMPTY_REF_LABELS,
  emptyAction,
}: OrgsListProps): React.ReactNode {
  const tContacts = useAppTranslations("contacts");

  const locale = useLocale();
  const catalog = useMemo(
    () => [...orgColumns(locale), ...customFieldColumns(customFieldDefs)],
    [customFieldDefs, locale],
  );
  const columns = useColumns(catalog, initialColumns);
  usePersistColumns("orgs", columns.order);
  const selection = useRowSelection();
  // Depend on the stable callback, not the selection object, which is recreated every render.
  const clearSelection = selection.clear;
  const { effective, cycle } = useColumnSort<OrgSortField>(DEFAULT_SORT);
  const [filter, setFilter] = useState<ContactFilterDefinition | null>(null);
  // The saved view the filter came from, so the picker can show which one is applied.
  const [savedView, setSavedView] = useState<SavedView | null>(null);
  const savedViewId = savedView?.id ?? null;
  const blocked = savedView?.availability === "unavailable";
  // Whether the pair-merge dialog is open (only reachable with exactly two rows selected).
  const [merging, setMerging] = useState(false);

  const searchInput = useContactSearch();
  const { rows, total, refLabels, loading, error, setError, loadMore, reload } = useOrgsListPaging({
    initial,
    initialTotal,
    initialRefLabels,
    sort: effective,
    filter,
    enabled: !blocked,
    search: searchInput.search,
  });

  // Re-query the first page under the new sort. Skip the initial mount: the first page is
  // already seeded server-side under the default sort, so firing here too would double-fetch.
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    clearSelection();
    void reload();
  }, [reload, clearSelection]);

  async function bulkDelete(): Promise<void> {
    if (blocked) return;
    const ids = [...selection.selected];
    if (ids.length === 0) return;
    const outcomes = await Promise.all(
      ids.map(async (id) => ({ id, result: await deleteOrgAction({ id }, readCsrfToken()) })),
    );
    const failedIds = outcomes.filter((o) => o.result.ok === false).map((o) => o.id);
    // Don't silently drop failures: clear only the ids that actually deleted, keep the
    // failed ones selected (so the user sees exactly what still needs attention).
    selection.clear();
    for (const id of failedIds) selection.toggle(id);
    // reload() manages `error` itself (clears it, then sets RELOAD_ERROR on its own
    // failure), so set the bulk-delete error AFTER it settles or reload would wipe it out.
    await reload();
    if (failedIds.length > 0) setError(tContacts("couldnTDeleteSomeOrganizationsPleaseTryAgain"));
  }

  const narrowed = searchInput.draft.trim() !== "" || filter !== null;
  const busy = loading || searchInput.settling;
  function clearCriteria(): void {
    searchInput.clear();
    setFilter(null);
    setSavedView(null);
    selection.clear();
  }

  const visibleIds = rows.map((r) => r.id);
  // The two records to merge when exactly two are selected (Pipedrive merges pairs). The tuple cast
  // is guarded by the length check, so both entries are present.
  const selectedRecords = rows
    .filter((r) => selection.isSelected(r.id))
    .map((r) => ({ id: r.id, name: r.name }));
  const mergePair =
    selectedRecords.length === 2
      ? (selectedRecords as [{ id: string; name: string }, { id: string; name: string }])
      : null;

  return (
    <section aria-busy={busy} className="overflow-hidden rounded-xl border bg-card shadow-sm">
      <ContactDirectoryToolbar
        kind="org"
        draft={searchInput.draft}
        onSearch={(value) => {
          searchInput.setDraft(value);
          selection.clear();
        }}
        onSubmit={searchInput.submit}
        onClear={searchInput.clear}
        summary={
          blocked
            ? null
            : busy
              ? tContacts("directory.updating")
              : tContacts("countLabel", { shown: rows.length, total })
        }
      >
        <OrgsListToolbar
          filter={filter}
          savedViewId={savedViewId}
          selectedView={savedView}
          onSelectView={(view) => {
            setSavedView(view);
            setFilter(view?.definition ?? null);
            selection.clear();
            setMerging(false);
          }}
          onApplyFilter={(def) => {
            setSavedView(null);
            setFilter(def);
            selection.clear();
            setMerging(false);
          }}
        />

        <ColumnsMenu
          catalog={catalog}
          order={columns.order}
          visibleKeys={columns.visibleKeys}
          onToggle={columns.toggle}
          onReorder={columns.reorder}
        />
      </ContactDirectoryToolbar>
      {!blocked && narrowed && (
        <ContactDirectoryCriteria
          query={searchInput.draft.trim()}
          count={filter?.conditions.length ?? 0}
          onClear={clearCriteria}
        />
      )}
      {!blocked && selection.count > 0 && (
        <BulkActionBar count={selection.count} onClear={selection.clear}>
          {mergePair !== null && (
            <button
              type="button"
              onClick={() => setMerging(true)}
              className="rounded-md border px-3 py-1 text-sm hover:bg-accent active:scale-[0.96] transition-transform"
            >
              {tContacts("mergeDuplicates")}
            </button>
          )}
          <BulkDeleteButton
            count={selection.count}
            noun="organization"
            nounPlural="organizations"
            onConfirm={() => void bulkDelete()}
          />
        </BulkActionBar>
      )}
      {merging && mergePair !== null && (
        <BulkMergeDialog
          kind="org"
          records={mergePair}
          onMerged={() => {
            setMerging(false);
            selection.clear();
            void reload();
          }}
          onClose={() => setMerging(false)}
        />
      )}
      {blocked || (rows.length === 0 && error !== null) ? null : rows.length === 0 && !busy ? (
        <ContactDirectoryEmptyState
          kind="org"
          narrowed={narrowed}
          onClear={clearCriteria}
          action={emptyAction}
        />
      ) : (
        <div>
          <CustomFieldRefLabelsProvider value={refLabels}>
            <OrgsTable
              rows={rows}
              sort={effective}
              onSort={cycle}
              isSelected={selection.isSelected}
              allSelected={selection.allSelected(visibleIds)}
              onToggleRow={selection.toggle}
              onToggleAll={() => selection.toggleAll(visibleIds)}
              visibleColumns={columns.visibleColumns}
              currency={baseCurrency}
            />
          </CustomFieldRefLabelsProvider>
        </div>
      )}
      {!blocked && error !== null && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-sm text-destructive"
        >
          <span>{error}</span>
          <Button type="button" size="sm" variant="outline" onClick={() => void reload()}>
            {tContacts("directory.retry")}
          </Button>
        </div>
      )}
      {!blocked && (
        <footer className="flex min-h-14 flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
          <p className="text-xs text-muted-foreground tabular-nums">
            {busy
              ? tContacts("directory.updating")
              : tContacts("countLabel", { shown: rows.length, total })}
          </p>
          {rows.length < total && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void loadMore()}
            >
              {loading ? tContacts("loading") : tContacts("loadMore")}
            </Button>
          )}
        </footer>
      )}
    </section>
  );
}
