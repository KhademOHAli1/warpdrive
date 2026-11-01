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
import { SavedViewControl } from "@/features/saved-filters/SavedViewControl";
import type { SavedView } from "@/features/saved-filters/savedView";
import type { CustomFieldDef } from "@/types/customFields";
import { readCsrfToken } from "@/utils/csrfCookie";
import { deletePersonAction } from "./actions";
import { BulkMergeDialog } from "./BulkMergeDialog";
import {
  ContactDirectoryCriteria,
  ContactDirectoryEmptyState,
  ContactDirectoryToolbar,
} from "./ContactDirectorySurface";
import { ContactFilterBuilder } from "./ContactFilterBuilder";
import { type ContactFilterDefinition, PERSON_FILTER_CONFIG } from "./contactFilterConfig";
import { personFilterLabels } from "./contactFilterRows";
import type { PeopleListRow } from "./PeopleTable";
import { PeopleTable } from "./PeopleTable";
import { peopleColumns } from "./peopleColumns";
import type { PersonSortField } from "./schemas";
import { useContactSearch } from "./useContactSearch";
import { usePeopleListPaging } from "./usePeopleListPaging";

// Stable module reference: passed as useColumnSort's fallback, so `effective` only changes
// reference when the sort state itself changes (not on every PeopleList re-render).
const DEFAULT_SORT: ColumnSort<PersonSortField> = { field: "name", dir: "asc" };
// Stable default for the orgNames prop: a `= {}` default parameter allocates a NEW object on
// every call, which would make fetchPage's useCallback (and the sort-change effect that
// depends on it) re-fire on every render instead of only on a real sort change.
const EMPTY_ORG_NAMES: Record<string, string> = {};
const EMPTY_CUSTOM_FIELD_DEFS: CustomFieldDef[] = [];

export interface PeopleListProps {
  rows: PeopleListRow[];
  total: number;
  // Org id -> name for resolving appended rows. Server seeds this from the visible org set;
  // orgs beyond that set (the separate 500-org resolution cap) simply stay unnamed.
  orgNames?: Record<string, string>;
  // Seeded from user_preferences.ui.peopleView (server); falls back to catalog defaults.
  initialColumns?: string[];
  customFieldDefs?: CustomFieldDef[];
  baseCurrency?: string;
  refLabels?: CustomFieldRefLabels;
  emptyAction?: React.ReactNode;
}

// People list for the Contacts nav. Client-side "Load more" pages through the rest of the
// visible set via contacts.listPeople; the first page is seeded server-side. Row selection,
// column sort, and bulk delete adopt the shared Wave 1 data-table hooks (see LeadsInbox for
// the same pattern applied to leads).
export function PeopleList({
  rows: initial,
  total: initialTotal,
  orgNames = EMPTY_ORG_NAMES,
  initialColumns,
  customFieldDefs = EMPTY_CUSTOM_FIELD_DEFS,
  baseCurrency = DEFAULT_BASE_CURRENCY,
  refLabels: initialRefLabels = EMPTY_REF_LABELS,
  emptyAction,
}: PeopleListProps): React.ReactNode {
  const tContacts = useAppTranslations("contacts");

  const locale = useLocale();
  const catalog = useMemo(
    () => [...peopleColumns(locale), ...customFieldColumns(customFieldDefs)],
    [customFieldDefs, locale],
  );
  const columns = useColumns(catalog, initialColumns);
  usePersistColumns("people", columns.order);
  const selection = useRowSelection();
  // Depend on the stable callback, not the selection object, which is recreated every render.
  const clearSelection = selection.clear;
  const { effective, cycle } = useColumnSort<PersonSortField>(DEFAULT_SORT);
  // Server-side condition filter. A change re-queries page 0 (fetchPage depends on it, and the
  // sort/filter-change effect reloads on that dependency).
  const [filter, setFilter] = useState<ContactFilterDefinition | null>(null);
  // The saved view the filter came from, so the picker can show which one is applied.
  const [savedView, setSavedView] = useState<SavedView | null>(null);
  const savedViewId = savedView?.id ?? null;
  const blocked = savedView?.availability === "unavailable";
  // Whether the pair-merge dialog is open (only reachable with exactly two rows selected).
  const [merging, setMerging] = useState(false);
  const searchInput = useContactSearch();
  const { rows, total, refLabels, loading, error, setError, loadMore, reload } =
    usePeopleListPaging({
      initial,
      initialTotal,
      initialRefLabels,
      orgNames,
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
      ids.map(async (id) => ({ id, result: await deletePersonAction({ id }, readCsrfToken()) })),
    );
    const failedIds = outcomes.filter((o) => o.result.ok === false).map((o) => o.id);
    // Don't silently drop failures: clear only the ids that actually deleted, keep the
    // failed ones selected (so the user sees exactly what still needs attention).
    selection.clear();
    for (const id of failedIds) selection.toggle(id);
    // reload() manages `error` itself (clears it, then sets RELOAD_ERROR on its own
    // failure), so set the bulk-delete error AFTER it settles or reload would wipe it out.
    await reload();
    if (failedIds.length > 0) setError(tContacts("couldnTDeleteSomePeoplePleaseTryAgain"));
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
        kind="person"
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
        <SavedViewControl
          targetEntity="person"
          allLabel={tContacts("allPeople")}
          currentDefinition={filter}
          selectedViewId={savedViewId}
          selectedView={savedView}
          onSelectView={(view) => {
            setSavedView(view);
            setFilter(view?.definition ?? null);
            selection.clear();
            setMerging(false);
          }}
        />
        <ContactFilterBuilder
          config={PERSON_FILTER_CONFIG}
          fieldLabels={personFilterLabels(locale)}
          activeCount={filter?.conditions.length ?? 0}
          appliedDefinition={filter}
          onApply={(def) => {
            // An ad-hoc edit is no longer the saved view, so the picker stops claiming it is.
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
            noun="person"
            nounPlural="people"
            onConfirm={() => void bulkDelete()}
          />
        </BulkActionBar>
      )}
      {merging && mergePair !== null && (
        <BulkMergeDialog
          kind="person"
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
          kind="person"
          narrowed={narrowed}
          onClear={clearCriteria}
          action={emptyAction}
        />
      ) : (
        <div>
          <CustomFieldRefLabelsProvider value={refLabels}>
            <PeopleTable
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
