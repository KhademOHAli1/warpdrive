"use client";

import { ArrowRightLeft, ClipboardCheck, Plus, RefreshCw, Search, Settings2 } from "lucide-react";
import Link from "next/link";
import { useId, useRef, useState } from "react";
import { PageHeading } from "@/components/shell/PageHeading";
import { Badge } from "@/components/ui/Badge";
import { Button, buttonVariants } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { PILL_TAB, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  type CommissionStockAdapter,
  useCommissionStock,
} from "@/features/assets/commissioning/ui/CommissionStockPanel";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import {
  CatalogCheckbox as CheckboxField,
  CatalogField as Field,
  CatalogSelect as FieldSelect,
} from "../../catalog/ui/CatalogFields";
import type {
  WarehouseCommand,
  WarehouseError,
  WarehouseResult,
  WarehouseWorkspace,
} from "../contracts";
import { operationsMessages } from "../operations/ui/operationsMessages";
import { stocktakeMessages } from "../stocktakes/ui/messages";
import {
  WarehouseIntakeDialog,
  WarehousePolicyDialog,
  WarehouseStateDialog,
} from "./WarehouseDialogs";
import {
  WarehouseBalancesTable,
  WarehouseIncomingTable,
  WarehousePositionsTable,
} from "./WarehouseTables";
import {
  inWarehouseScope,
  locationOptions,
  managedLocations,
  receivableLocations,
  type SaveWarehouse,
  unlocatedFilter,
  type WarehouseDialogProps,
  type WarehouseEditor,
  type WarehouseFilters,
  warehouseFilters,
  warehousePartLabel,
  warehouseSiteLabel,
} from "./warehouseDisplay";
import { type WarehouseWords, warehouseMessages } from "./warehouseMessages";

type Tab = "balances" | "positions" | "incomingStock";

function useWarehouseCommand(
  submit: (command: WarehouseCommand) => Promise<WarehouseResult>,
  refreshing: boolean,
) {
  const pendingRequest = useRef(false);
  const commandIds = useRef(new Map<string, string>());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<WarehouseError | "transport" | null>(null);
  const [notice, setNotice] = useState(false);

  function clear() {
    setError(null);
    setNotice(false);
  }

  const run: SaveWarehouse = async (intent) => {
    if (pendingRequest.current || refreshing) return { ok: false, error: "transport" };
    pendingRequest.current = true;
    setPending(true);
    clear();
    const key = JSON.stringify(intent);
    const requestId = commandIds.current.get(key) ?? crypto.randomUUID();
    commandIds.current.set(key, requestId);
    try {
      const result = await submit({ ...intent, requestId });
      commandIds.current.delete(key);
      if (result.ok) setNotice(true);
      else setError(result.error);
      return result;
    } catch {
      setError("transport");
      return { ok: false, error: "transport" };
    } finally {
      pendingRequest.current = false;
      setPending(false);
    }
  };

  return { pending, error, notice, clear, run };
}

function filteredRows(workspace: WarehouseWorkspace, filters: WarehouseFilters, locale: string) {
  const search = filters.search.trim().toLocaleLowerCase(locale);
  const partMatches = new Set(
    workspace.parts
      .filter(({ code, sku, name, revision }) =>
        [code, sku, name, revision].some((value) =>
          value.toLocaleLowerCase(locale).includes(search),
        ),
      )
      .map(({ id }) => id),
  );
  const matchesText = (value: string | null) =>
    value?.toLocaleLowerCase(locale).includes(search) === true;
  return {
    balances: workspace.balances.filter(
      (row) => inWarehouseScope(row, filters) && partMatches.has(row.itemId),
    ),
    positions: workspace.positions.filter(
      (row) =>
        (filters.includeEmpty || row.onHand > 0) &&
        inWarehouseScope(row, filters) &&
        (partMatches.has(row.itemId) || matchesText(row.lot) || matchesText(row.serial)),
    ),
    incoming: workspace.incoming.filter(
      (row) =>
        inWarehouseScope(row, filters) &&
        (partMatches.has(row.itemId) || matchesText(row.reference)),
    ),
  };
}

export function WarehouseWorkspaceView({
  initial,
  submit,
  fixture = false,
  refresh,
  refreshing = false,
  commissioning,
}: {
  initial: WarehouseWorkspace;
  submit: (command: WarehouseCommand) => Promise<WarehouseResult>;
  fixture?: boolean;
  refresh?: () => void;
  refreshing?: boolean;
  commissioning?: CommissionStockAdapter;
}) {
  const locale = useLocale();
  const t = warehouseMessages[locale];
  const [source, setSource] = useState(initial);
  const [workspace, setWorkspace] = useState(initial);
  const [tab, setTab] = useState<Tab>("balances");
  const [filters, setFilters] = useState(warehouseFilters);
  const [editor, setEditor] = useState<WarehouseEditor | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const positionsTab = useRef<HTMLButtonElement | null>(null);
  const command = useWarehouseCommand(submit, refreshing);
  const warehouseBusy = command.pending || refreshing;
  const commission = useCommissionStock({
    adapter: commissioning,
    busy: warehouseBusy,
    positionsTab,
    updateWorkspace: setWorkspace,
  });

  if (source !== initial) {
    setSource(initial);
    setWorkspace(initial);
    setEditor(null);
    command.clear();
  }

  const busy = warehouseBusy || commission.pending;
  const rows = filteredRows(workspace, filters, locale);

  function show(triggerButton: HTMLButtonElement, next: WarehouseEditor) {
    trigger.current = triggerButton;
    command.clear();
    setEditor(next);
  }

  const save: SaveWarehouse = async (intent) => {
    const result = await command.run(intent);
    if (result.ok) {
      setWorkspace(result.value);
      setEditor(null);
      if (intent.type === "createIncoming") setTab("incomingStock");
      if (intent.type === "receive" || intent.type === "reconcile") setTab("positions");
    }
    return result;
  };

  return (
    <main className={`${BLOCK_CLASS} ph-no-capture min-w-0`} aria-busy={busy}>
      <PageHeading
        title={t.title}
        crumbs={[{ label: t.inventory, href: "/inventory" }, { label: t.title }]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {fixture && <Badge variant="outline">{t.demo}</Badge>}
            {!fixture && (
              <>
                <Link
                  href="/inventory/warehouse/operations"
                  className={buttonVariants({ size: "sm", variant: "outline" })}
                >
                  <ArrowRightLeft aria-hidden="true" />
                  {operationsMessages[locale].title}
                </Link>
                <Link
                  href="/inventory/warehouse/stocktakes"
                  prefetch={false}
                  className={buttonVariants({ size: "sm", variant: "outline" })}
                >
                  <ClipboardCheck aria-hidden="true" />
                  {stocktakeMessages[locale].title}
                </Link>
              </>
            )}
            {!fixture && refresh !== undefined && (
              <Button size="sm" variant="outline" disabled={busy} onClick={refresh}>
                <RefreshCw aria-hidden="true" />
                {t.refresh}
              </Button>
            )}
          </div>
        }
      />
      <WarehouseToolbar
        t={t}
        workspace={workspace}
        tab={tab}
        filters={filters}
        change={setFilters}
        busy={busy}
        show={show}
      />
      {command.notice && (
        <p role="status" className="mb-3 text-sm text-muted-foreground">
          {t.stockSaved}
        </p>
      )}
      {command.error !== null && editor === null && (
        <p role="alert" className="mb-3 text-sm text-destructive">
          {t[command.error]}
        </p>
      )}
      {commission.notice}
      <Tabs
        value={tab}
        onValueChange={(next) => {
          if (next === "balances" || next === "positions" || next === "incomingStock") setTab(next);
        }}
      >
        <TabsList
          aria-label={t.title}
          className="inline-flex w-fit max-w-full flex-wrap gap-1 rounded-lg border bg-card p-0.5"
        >
          <TabsTrigger className={PILL_TAB} value="balances">
            {t.balances}
          </TabsTrigger>
          <TabsTrigger ref={positionsTab} className={PILL_TAB} value="positions">
            {t.positions}
          </TabsTrigger>
          <TabsTrigger className={PILL_TAB} value="incomingStock">
            {t.incomingStock}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="balances">
          <WarehouseBalancesTable rows={rows.balances} workspace={workspace} t={t} />
        </TabsContent>
        <TabsContent value="positions">
          <WarehousePositionsTable
            rows={rows.positions}
            workspace={workspace}
            busy={busy}
            changeState={(button, position) => show(button, { type: "setPositionState", position })}
            commissioning={commission.row}
          />
        </TabsContent>
        <TabsContent value="incomingStock">
          <WarehouseIncomingTable
            rows={rows.incoming}
            workspace={workspace}
            busy={busy}
            receive={(button, incoming) => show(button, { type: "receive", incoming })}
            cancel={(id) => {
              void save({ type: "cancelIncoming", id });
            }}
          />
        </TabsContent>
      </Tabs>
      {editor !== null && (
        <WarehouseEditorContent
          editor={editor}
          workspace={workspace}
          filters={filters}
          pending={busy}
          error={command.error === null ? null : t[command.error]}
          close={() => {
            setEditor(null);
            command.clear();
          }}
          restoreFocus={() => trigger.current?.focus()}
          save={save}
        />
      )}
      {commission.dialog}
    </main>
  );
}

function WarehouseToolbar({
  t,
  workspace,
  tab,
  filters,
  change,
  busy,
  show,
}: {
  t: WarehouseWords;
  workspace: WarehouseWorkspace;
  tab: Tab;
  filters: WarehouseFilters;
  change: (filters: WarehouseFilters) => void;
  busy: boolean;
  show: (trigger: HTMLButtonElement, editor: WarehouseEditor) => void;
}) {
  const optionsId = useId();
  const sites = workspace.sites.map((site) => ({
    value: site.id,
    label: warehouseSiteLabel(site),
  }));
  const locations = workspace.locations.filter(
    (location) => filters.site === "" || filters.site === location.siteId,
  );
  const placeholders = {
    balances: t.searchPart,
    positions: t.searchPosition,
    incomingStock: t.searchIncoming,
  };
  return (
    <section className="mb-4 grid gap-3 rounded-lg border bg-card p-3" aria-label={t.search}>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(11rem,2fr)_repeat(3,minmax(0,1fr))]">
        <div className="relative flex min-w-0 flex-col items-stretch justify-end">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute bottom-2.5 start-2.5 size-4 text-muted-foreground"
          />
          <Input
            type="search"
            aria-label={t.search}
            placeholder={placeholders[tab]}
            maxLength={160}
            value={filters.search}
            onChange={(event) => change({ ...filters, search: event.target.value })}
            className="ps-8"
          />
        </div>
        <Field label={t.part}>
          <FieldSelect
            ariaLabel={t.part}
            value={filters.part}
            options={[
              { value: "", label: t.allParts },
              ...workspace.parts.map((part) => ({
                value: part.id,
                label: warehousePartLabel(part),
              })),
            ]}
            onChange={(part) => change({ ...filters, part })}
          />
        </Field>
        <Field label={t.site}>
          <FieldSelect
            ariaLabel={t.site}
            value={filters.site}
            options={[
              { value: "", label: t.allSites },
              ...sites,
              ...(workspace.canManageUnlocated
                ? [{ value: unlocatedFilter, label: t.unlocated }]
                : []),
            ]}
            onChange={(site) => change({ ...filters, site, location: "" })}
          />
        </Field>
        <Field label={t.location}>
          <FieldSelect
            ariaLabel={t.location}
            value={filters.location}
            disabled={locations.length === 0}
            options={[
              { value: "", label: t.allLocations },
              ...locationOptions(locations, workspace),
            ]}
            onChange={(location) => change({ ...filters, location })}
          />
        </Field>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <WarehouseToolbarActions t={t} workspace={workspace} busy={busy} show={show} />
        {tab === "positions" && (
          <CheckboxField
            id={optionsId}
            label={t.includeEmpty}
            checked={filters.includeEmpty}
            change={(includeEmpty) => change({ ...filters, includeEmpty })}
          />
        )}
      </div>
    </section>
  );
}

function WarehouseToolbarActions({
  t,
  workspace,
  busy,
  show,
}: {
  t: WarehouseWords;
  workspace: WarehouseWorkspace;
  busy: boolean;
  show: (trigger: HTMLButtonElement, editor: WarehouseEditor) => void;
}) {
  const locations = receivableLocations(workspace);
  const canIntake = locations.length > 0 && workspace.parts.some(({ canReceive }) => canReceive);
  const canReconcile =
    canIntake &&
    workspace.canManageUnlocated &&
    workspace.balances.some(
      (row) =>
        row.siteId === null &&
        row.onHand > row.reserved &&
        workspace.parts.some((part) => part.id === row.itemId && part.canReceive),
    );
  return (
    <div className="flex flex-wrap items-center gap-2">
      {canIntake && (
        <Button
          size="sm"
          disabled={busy}
          onClick={(event) => show(event.currentTarget, { type: "receive", incoming: null })}
        >
          <Plus aria-hidden="true" />
          {t.receive}
        </Button>
      )}
      {canReconcile && (
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={(event) => show(event.currentTarget, { type: "reconcile" })}
        >
          {t.reconcile}
        </Button>
      )}
      {canIntake && (
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={(event) => show(event.currentTarget, { type: "createIncoming" })}
        >
          {t.recordIncoming}
        </Button>
      )}
      {managedLocations(workspace).length > 0 && (
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={(event) => show(event.currentTarget, { type: "saveLocationPolicy" })}
        >
          <Settings2 aria-hidden="true" />
          {t.policy}
        </Button>
      )}
      <Link
        href="/locations"
        className="text-xs font-medium text-primary underline-offset-4 hover:underline"
      >
        {t.locations}
      </Link>
    </div>
  );
}

function WarehouseEditorContent({
  editor,
  workspace,
  filters,
  ...dialog
}: WarehouseDialogProps & {
  editor: WarehouseEditor;
  workspace: WarehouseWorkspace;
  filters: WarehouseFilters;
}) {
  if (editor.type === "saveLocationPolicy")
    return (
      <WarehousePolicyDialog
        {...dialog}
        workspace={workspace}
        initialLocationId={filters.location}
      />
    );
  if (editor.type === "setPositionState")
    return <WarehouseStateDialog {...dialog} position={editor.position} />;
  return (
    <WarehouseIntakeDialog
      {...dialog}
      workspace={workspace}
      mode={editor.type}
      initialLocationId={filters.location}
      initialPartId={filters.part}
      incoming={editor.type === "receive" ? editor.incoming : null}
    />
  );
}
