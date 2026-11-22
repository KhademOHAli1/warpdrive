"use client";

import { type RefObject, useMemo, useState } from "react";
import { ColumnsMenu } from "@/components/data-table/ColumnsMenu";
import { useColumns } from "@/components/data-table/useColumns";
import { Button } from "@/components/ui/Button";
import type { Locale } from "@/features/i18n/registry";
import type { AssetRecord, AssetsWorkspace } from "../../contracts";
import type { AssetTablePresentation } from "../../ui/AssetTable";
import type { AssetWords } from "../../ui/assetMessages";
import {
  type AssetRegisterDiscoveryAccess,
  type AssetRegisterFilters,
  type AssetRegisterSettings,
  type AssetRegisterSort,
  defaultAssetRegisterColumns,
} from "../contracts";
import { assetRegisterSettingsAvailable, maxAssetRegisterSearchLength } from "../settings";
import { sortAssetRegisterRecords } from "../sort";
import { AssetRegisterBulkActions, useAssetRegisterBatch } from "./AssetRegisterBatch";
import { AssetRegisterSortMenu } from "./AssetRegisterSortMenu";
import { AssetRegisterViewsMenu } from "./AssetRegisterViewsMenu";
import { discoveryMessages } from "./messages";
import { cycleAssetRegisterSort, registerColumnCatalog } from "./presentation";

export function useAssetRegisterDiscovery({
  access,
  workspace,
  filters,
  locale,
  words,
  holder,
  inFlightRef,
  onWorkspace,
  onApplyFilters,
  clearCustody,
}: {
  access?: AssetRegisterDiscoveryAccess;
  workspace: AssetsWorkspace;
  filters: AssetRegisterFilters;
  locale: Locale;
  words: AssetWords;
  holder: string;
  inFlightRef: RefObject<boolean>;
  onWorkspace: (next: AssetsWorkspace) => void;
  onApplyFilters: (next: AssetRegisterFilters) => void;
  clearCustody: () => void;
}) {
  const [sort, setSort] = useState<AssetRegisterSort>([]);
  const [activeView, setActiveView] = useState<string | null>(null);
  const holderAvailable = workspace.custody !== undefined || workspace.kits !== undefined;
  const catalog = useMemo(
    () => registerColumnCatalog(words, holder, holderAvailable),
    [words, holder, holderAvailable],
  );
  const columns = useColumns(catalog, undefined);
  const siteId =
    filters.status === "active" &&
    workspace.sites.some((site) => site.id === filters.site && site.canManage)
      ? filters.site
      : null;
  const batch = useAssetRegisterBatch({ access, siteId, inFlightRef, onWorkspace });
  const settings: AssetRegisterSettings = {
    filters,
    columns: columns.visibleColumns.map(({ key }) => key),
    sort,
  };
  function changeSort(next: AssetRegisterSort) {
    setSort(next);
    clearCustody();
    batch.clearSelection();
  }
  function applyView(next: AssetRegisterSettings, id: string | null) {
    onApplyFilters(next.filters);
    changeSort(next.sort);
    columns.replace(next.columns);
    setActiveView(id);
  }
  const presentation: AssetTablePresentation | undefined =
    access === undefined
      ? undefined
      : {
          columns: settings.columns,
          sort,
          changeSort: (column) => changeSort(cycleAssetRegisterSort(sort, column)),
        };
  return {
    activeView,
    setActiveView,
    settings,
    catalog,
    columns,
    batch,
    presentation,
    changeSort,
    applyView,
    searchLimit: access === undefined ? undefined : maxAssetRegisterSearchLength,
    sortRecords: (records: AssetRecord[], locationLabels: ReadonlyMap<string, string>) =>
      access !== undefined && sort.length > 0
        ? sortAssetRegisterRecords(records, workspace, locationLabels, sort, locale)
        : records,
    toggleBulk: () => {
      clearCustody();
      batch.toggle();
    },
  };
}

type DiscoveryState = ReturnType<typeof useAssetRegisterDiscovery>;

export function AssetRegisterDiscoveryToolbar({
  access,
  state,
  workspace,
  defaults,
  busy,
  locale,
  assetWords,
}: {
  access?: AssetRegisterDiscoveryAccess;
  state: DiscoveryState;
  workspace: AssetsWorkspace;
  defaults: AssetRegisterFilters;
  busy: boolean;
  locale: Locale;
  assetWords: AssetWords;
}) {
  if (access === undefined) return null;
  const t = discoveryMessages[locale];
  const { batch, columns, catalog, settings, activeView, applyView, setActiveView } = state;
  return (
    <div data-asset-discovery className="flex min-w-0 flex-wrap items-start gap-2">
      <AssetRegisterViewsMenu
        access={access}
        workspace={workspace}
        settings={settings}
        activeView={activeView}
        onApply={applyView}
        onDefault={() =>
          applyView(
            { filters: defaults, columns: [...defaultAssetRegisterColumns], sort: [] },
            null,
          )
        }
        onActiveView={setActiveView}
        words={t}
      />
      <AssetRegisterSortMenu
        sort={settings.sort}
        change={state.changeSort}
        assetWords={assetWords}
        words={t}
      />
      <ColumnsMenu
        catalog={catalog}
        order={columns.order}
        visibleKeys={columns.visibleKeys}
        onToggle={columns.toggle}
        onReorder={columns.reorder}
      />
      {batch.permitted && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          data-asset-bulk-mode
          aria-pressed={batch.selecting}
          disabled={busy}
          onClick={state.toggleBulk}
        >
          {batch.selecting ? t.stopBatch : t.batchMode}
        </Button>
      )}
      {activeView !== null && !assetRegisterSettingsAvailable(workspace, settings) && (
        <p role="alert" className="basis-full text-sm text-destructive">
          {t.scopeLost}
        </p>
      )}
    </div>
  );
}

export function AssetRegisterMetadataActions({
  state,
  records,
  workspace,
  busy,
  fallbackFocus,
  assetWords,
  locale,
}: {
  state: DiscoveryState;
  records: AssetRecord[];
  workspace: AssetsWorkspace;
  busy: boolean;
  fallbackFocus: () => void;
  assetWords: AssetWords;
  locale: Locale;
}) {
  return (
    <AssetRegisterBulkActions
      state={state.batch}
      records={records}
      workspace={workspace}
      busy={busy}
      fallbackFocus={fallbackFocus}
      assetWords={assetWords}
      words={discoveryMessages[locale]}
    />
  );
}
