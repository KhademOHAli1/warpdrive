import type { ReactNode } from "react";
import { SortableHeader } from "@/components/data-table/SortableHeader";
import { Checkbox } from "@/components/ui/Checkbox";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { useHydrated } from "@/lib/useHydrated";
import type { AssetRecord, AssetsWorkspace } from "../contracts";
import type { CustodyHolding } from "../custody/contracts";
import type { CustodyWords } from "../custody/ui/messages";
import {
  type AssetRegisterColumn,
  type AssetRegisterSort,
  type AssetRegisterSortableColumn,
  assetRegisterSortableColumns,
  defaultAssetRegisterColumns,
  maxAssetRegisterSelection,
} from "../discovery/contracts";
import { discoveryMessages } from "../discovery/ui/messages";
import { kitRemaining, kitsForAsset } from "../kits/ui/kitView";
import { kitMessages } from "../kits/ui/messages";
import { kitUsesAsset } from "../kits/usage";
import type { AssetWords } from "./assetMessages";

const header = "px-3 py-2.5 font-medium text-muted-foreground";
const cell = "px-3 py-2.5 align-middle";
const wrapCell = `${cell} max-w-56 [overflow-wrap:anywhere]`;

type Holder = Pick<CustodyHolding, "id" | "custodianName" | "quantity">;
type AssetSelection = {
  selected: ReadonlySet<string>;
  onChange: (ids: string[], checked: boolean) => void;
  busy: boolean;
  kind?: "metadata";
};

export type AssetTablePresentation = {
  columns: AssetRegisterColumn[];
  sort: AssetRegisterSort;
  changeSort: (column: AssetRegisterSortableColumn) => void;
};

type RowDisplay = {
  number: Intl.NumberFormat | null;
  sites: ReadonlyMap<string, string>;
  categories: ReadonlyMap<string, string>;
  models: ReadonlyMap<string, string>;
  locations: ReadonlyMap<string, string>;
  holders: ReadonlyMap<string, Holder[]>;
};

function AssetHeaders({
  columns,
  presentation,
  words: t,
  custodyWords,
}: {
  columns: readonly AssetRegisterColumn[];
  presentation?: AssetTablePresentation;
  words: AssetWords;
  custodyWords: CustodyWords;
}) {
  const [primary] = presentation?.sort ?? [];
  return columns.map((column) => {
    const label = column === "holder" ? custodyWords.currentHolder : t[column];
    const className = `${header} ${column === "quantity" ? "text-end" : "text-start"}`;
    const sortable = assetRegisterSortableColumns.find((key) => key === column);
    if (sortable === undefined || presentation === undefined)
      return (
        <th scope="col" className={className} key={column}>
          {label}
        </th>
      );
    const order = presentation.sort.findIndex((item) => item.column === column);
    return (
      <SortableHeader
        key={column}
        field={sortable}
        label={label}
        className={className}
        sort={{ field: primary?.column ?? "none", dir: primary?.direction ?? "asc" }}
        onSort={() => presentation.changeSort(sortable)}
        afterButton={
          order > 0 && (
            <span className="ms-1 text-xs" aria-hidden="true">
              {order + 1}
            </span>
          )
        }
      />
    );
  });
}

function AssetDataCells({
  columns,
  legacy,
  record,
  display,
  words: t,
  custodyWords,
}: {
  columns: readonly AssetRegisterColumn[];
  legacy: boolean;
  record: AssetRecord;
  display: RowDisplay;
  words: AssetWords;
  custodyWords: CustodyWords;
}) {
  const individual = record.tracking === "individual";
  const serial = individual ? record.serial : null;
  const model = individual && record.modelId !== null ? display.models.get(record.modelId) : null;
  const category = record.categoryId === null ? null : display.categories.get(record.categoryId);
  const balances = individual ? [] : record.balances.filter(({ quantity }) => quantity > 0);
  const singleLocation = individual ? record.locationId : balances[0]?.locationId;
  const location =
    balances.length > 1
      ? t.multipleLocations
      : singleLocation != null
        ? (display.locations.get(singleLocation) ?? "—")
        : individual
          ? t.unassigned
          : "—";
  const quantity = individual ? 1 : balances.reduce((total, bin) => total + bin.quantity, 0);
  const values: Record<Exclude<AssetRegisterColumn, "name">, ReactNode> = {
    tracking: (
      <>
        <span>{t[record.tracking]}</span>
        {legacy && serial !== null && (
          <bdi dir="auto" className="block text-xs text-muted-foreground">
            {serial}
          </bdi>
        )}
      </>
    ),
    location: (
      <>
        <bdi dir="auto">{location}</bdi>
        <bdi dir="auto" className="block text-xs text-muted-foreground">
          {display.sites.get(record.siteId)}
        </bdi>
      </>
    ),
    holder: (
      <RegisterHolder
        record={record}
        holdings={display.holders.get(record.id) ?? []}
        number={display.number}
        words={custodyWords}
      />
    ),
    quantity: display.number?.format(quantity) ?? quantity,
    serial: <bdi dir="auto">{serial ?? "—"}</bdi>,
    model: <bdi dir="auto">{model ?? "—"}</bdi>,
    category: <bdi dir="auto">{category ?? "—"}</bdi>,
    tags: <bdi dir="auto">{record.tags.length === 0 ? "—" : record.tags.join(" · ")}</bdi>,
  };
  return columns
    .filter((column) => column !== "name")
    .map((column) => (
      <td
        key={column}
        data-asset-column={column}
        className={column === "quantity" ? `${cell} text-end tabular-nums` : wrapCell}
      >
        {values[column]}
      </td>
    ));
}

function AssetName({
  record,
  workspace,
  legacy,
  category,
  selected,
  select,
  kitLabel,
}: {
  record: AssetRecord;
  workspace: AssetsWorkspace;
  legacy: boolean;
  category: string | undefined;
  selected: boolean;
  select: () => void;
  kitLabel: string;
}) {
  const kits = kitsForAsset(workspace, record.id);
  return (
    <th scope="row" className={`${cell} max-w-72 text-start font-normal`} data-asset-column="name">
      <button
        type="button"
        aria-controls="asset-register-detail"
        aria-pressed={selected}
        onClick={select}
        className="block rounded text-start font-semibold hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <bdi dir="auto" className="[overflow-wrap:anywhere]">
          {record.name}
        </bdi>
      </button>
      <span className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
        <bdi dir="auto">{record.code}</bdi>
        {legacy && category !== undefined && <bdi dir="auto">{category}</bdi>}
      </span>
      {kits.length > 0 && (
        <span className="block text-xs text-muted-foreground">
          <span className="me-1">{kitLabel}</span>
          <bdi>{kits.map(({ name }) => name).join(" · ")}</bdi>
        </span>
      )}
    </th>
  );
}

export function AssetTable({
  records,
  workspace,
  locationLabels,
  selectedId,
  onSelect,
  locale,
  words: t,
  custodyWords,
  selection,
  presentation,
}: {
  records: AssetRecord[];
  workspace: AssetsWorkspace;
  locationLabels: ReadonlyMap<string, string>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  locale: string;
  words: AssetWords;
  custodyWords: CustodyWords;
  selection?: AssetSelection;
  presentation?: AssetTablePresentation;
}) {
  const activeLocale = useLocale();
  const kitWords = kitMessages[activeLocale];
  const discoveryWords = discoveryMessages[activeLocale];
  const display: RowDisplay = {
    number: useHydrated() ? new Intl.NumberFormat(locale) : null,
    sites: new Map(workspace.sites.map(({ id, name }) => [id, name])),
    categories: new Map(workspace.categories.map(({ id, name }) => [id, name])),
    models: new Map(workspace.models.map(({ id, name }) => [id, name])),
    locations: locationLabels,
    holders: holdersByAsset(workspace),
  };
  const hasCustody = workspace.custody !== undefined || workspace.kits !== undefined;
  const columns =
    presentation?.columns ??
    defaultAssetRegisterColumns.filter((column) => column !== "holder" || hasCustody);
  const metadata = selection?.kind === "metadata";
  const visibleIds = records
    .filter(
      (record) =>
        metadata || record.tracking !== "individual" || !kitUsesAsset(workspace.kits, record.id),
    )
    .map(({ id }) => id);
  const selectable = new Set(visibleIds);
  const selectedCount = visibleIds.filter((id) => selection?.selected.has(id) === true).length;
  const toggleState =
    selectedCount === visibleIds.length ? true : selectedCount === 0 ? false : "indeterminate";
  return (
    <div className="min-w-0 overflow-x-auto rounded-lg border bg-card">
      <table
        aria-label={t.register}
        className={
          columns.includes("holder")
            ? "w-full min-w-[38rem] border-collapse text-sm"
            : "w-full min-w-[31rem] border-collapse text-sm"
        }
      >
        <thead className="border-b bg-muted/40">
          <tr>
            {selection !== undefined && (
              <th scope="col" className={`${header} w-12`}>
                {visibleIds.length > 0 && visibleIds.length <= maxAssetRegisterSelection && (
                  <Checkbox
                    checked={toggleState}
                    label={metadata ? discoveryWords.selectAll : custodyWords.selectAll}
                    disabled={selection.busy}
                    onCheckedChange={(checked) => selection.onChange(visibleIds, checked)}
                  />
                )}
              </th>
            )}
            <AssetHeaders
              columns={columns}
              presentation={presentation}
              words={t}
              custodyWords={custodyWords}
            />
          </tr>
        </thead>
        <tbody className="divide-y">
          {records.map((record) => {
            const locked = !selectable.has(record.id);
            const checked = !locked && selection?.selected.has(record.id) === true;
            const selected = record.id === selectedId;
            return (
              <tr
                key={record.id}
                data-asset-row={record.code}
                data-asset-row-id={record.id}
                data-selected={selected}
                className="hover:bg-muted/40 data-[selected=true]:bg-accent/75"
              >
                {selection !== undefined && (
                  <td className={cell}>
                    <Checkbox
                      checked={checked}
                      label={
                        metadata
                          ? `${discoveryWords.select} ${record.code}`
                          : `${custodyWords.selectAsset} ${record.name}`
                      }
                      disabled={
                        selection.busy ||
                        locked ||
                        (!checked && selection.selected.size >= maxAssetRegisterSelection)
                      }
                      onCheckedChange={(next) => selection.onChange([record.id], next)}
                    />
                  </td>
                )}
                <AssetName
                  record={record}
                  workspace={workspace}
                  legacy={presentation === undefined}
                  category={
                    record.categoryId === null
                      ? undefined
                      : display.categories.get(record.categoryId)
                  }
                  selected={selected}
                  select={() => onSelect(record.id)}
                  kitLabel={kitWords.kit}
                />
                <AssetDataCells
                  record={record}
                  columns={columns}
                  legacy={presentation === undefined}
                  display={display}
                  words={t}
                  custodyWords={custodyWords}
                />
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function holdersByAsset(workspace: AssetsWorkspace) {
  const result = new Map<string, Holder[]>();
  function add(assetId: string, holder: Holder) {
    const existing = result.get(assetId);
    if (existing === undefined) result.set(assetId, [holder]);
    else existing.push(holder);
  }
  for (const holding of workspace.custody?.holdings ?? []) add(holding.assetId, holding);
  for (const checkout of workspace.kits?.checkouts ?? []) {
    if (checkout.closedAt !== null) continue;
    for (const line of checkout.lines) {
      const quantity = kitRemaining(line);
      if (quantity > 0)
        add(line.assetId, { id: line.id, custodianName: checkout.custodianName, quantity });
    }
  }
  return result;
}

function RegisterHolder({
  record,
  holdings,
  number,
  words: t,
}: {
  record: AssetRecord;
  holdings: Holder[];
  number: Intl.NumberFormat | null;
  words: CustodyWords;
}) {
  if (holdings.length === 0) {
    return (
      <span className="text-muted-foreground">
        {record.tracking === "consumable_pool" ? "—" : t.noHolder}
      </span>
    );
  }
  return (
    <ul className="space-y-0.5">
      {holdings.map(({ id, custodianName, quantity }) => (
        <li key={id}>
          <bdi>{custodianName}</bdi>
          {record.tracking !== "individual" && (
            <span className="ms-2 text-xs text-muted-foreground">
              {number?.format(quantity) ?? quantity}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
