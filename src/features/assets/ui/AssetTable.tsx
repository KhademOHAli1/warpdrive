import { Checkbox } from "@/components/ui/Checkbox";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { useHydrated } from "@/lib/useHydrated";
import type { AssetRecord, AssetsWorkspace } from "../contracts";
import type { CustodyHolding } from "../custody/contracts";
import type { CustodyWords } from "../custody/ui/messages";
import { kitRemaining, kitsForAsset } from "../kits/ui/kitView";
import { kitMessages } from "../kits/ui/messages";
import { kitUsesAsset } from "../kits/usage";
import type { AssetWords } from "./assetMessages";

const header = "px-3 py-2.5 font-medium text-muted-foreground";
const cell = "px-3 py-2.5 align-middle";

type Holder = Pick<CustodyHolding, "id" | "custodianName" | "quantity">;

type AssetSelection = {
  selected: ReadonlySet<string>;
  onChange: (ids: string[], checked: boolean) => void;
  busy: boolean;
};

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
}) {
  const number = useHydrated() ? new Intl.NumberFormat(locale) : null;
  const kitWords = kitMessages[useLocale()];
  const sites = new Map(workspace.sites.map(({ id, name }) => [id, name]));
  const categories = new Map(workspace.categories.map(({ id, name }) => [id, name]));
  const held = holdersByAsset(workspace);
  const hasCustody = workspace.custody !== undefined || workspace.kits !== undefined;
  const kitManaged = new Set(
    records
      .filter(
        (record) => record.tracking === "individual" && kitUsesAsset(workspace.kits, record.id),
      )
      .map(({ id }) => id),
  );
  const visibleIds = records.filter(({ id }) => !kitManaged.has(id)).map(({ id }) => id);
  const selectedCount = visibleIds.filter((id) => selection?.selected.has(id) === true).length;
  const toggleState =
    selectedCount === visibleIds.length ? true : selectedCount === 0 ? false : "indeterminate";
  return (
    <div className="min-w-0 overflow-x-auto rounded-lg border bg-card">
      <table
        aria-label={t.register}
        className={
          hasCustody
            ? "w-full min-w-[38rem] border-collapse text-sm"
            : "w-full min-w-[31rem] border-collapse text-sm"
        }
      >
        <thead className="border-b bg-muted/40">
          <tr>
            {selection !== undefined && (
              <th scope="col" className={`${header} w-12`}>
                {visibleIds.length > 0 && visibleIds.length <= 100 && (
                  <Checkbox
                    checked={toggleState}
                    label={custodyWords.selectAll}
                    disabled={selection.busy}
                    onCheckedChange={(checked) => selection.onChange(visibleIds, checked)}
                  />
                )}
              </th>
            )}
            <th scope="col" className={`${header} text-start`}>
              {t.name}
            </th>
            <th scope="col" className={`${header} text-start`}>
              {t.tracking}
            </th>
            <th scope="col" className={`${header} text-start`}>
              {t.location}
            </th>
            {hasCustody && (
              <th scope="col" className={`${header} text-start`}>
                {custodyWords.currentHolder}
              </th>
            )}
            <th scope="col" className={`${header} text-end`}>
              {t.quantity}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {records.map((record) => {
            const individual = record.tracking === "individual";
            const category = record.categoryId === null ? null : categories.get(record.categoryId);
            const balances = individual
              ? []
              : record.balances.filter(({ quantity }) => quantity > 0);
            const singleLocation = individual ? record.locationId : balances[0]?.locationId;
            const location =
              balances.length > 1
                ? t.multipleLocations
                : singleLocation !== null && singleLocation !== undefined
                  ? (locationLabels.get(singleLocation) ?? "—")
                  : individual
                    ? t.unassigned
                    : "—";
            const quantity = individual
              ? 1
              : balances.reduce((total, bin) => total + bin.quantity, 0);

            const holdingRows = held.get(record.id) ?? [];
            const locked = kitManaged.has(record.id);
            const checked = !locked && selection?.selected.has(record.id) === true;
            const kits = kitsForAsset(workspace, record.id);

            return (
              <tr
                key={record.id}
                data-selected={record.id === selectedId}
                className="hover:bg-muted/40 data-[selected=true]:bg-accent/75"
              >
                {selection !== undefined && (
                  <td className={cell}>
                    <Checkbox
                      checked={checked}
                      label={`${custodyWords.selectAsset} ${record.name}`}
                      disabled={
                        selection.busy || locked || (!checked && selection.selected.size >= 100)
                      }
                      onCheckedChange={(next) => selection.onChange([record.id], next)}
                    />
                  </td>
                )}
                <th scope="row" className={`${cell} max-w-72 text-start font-normal`}>
                  <button
                    type="button"
                    aria-controls="asset-register-detail"
                    aria-pressed={record.id === selectedId}
                    onClick={() => onSelect(record.id)}
                    className="block rounded text-start font-semibold hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <bdi dir="auto" className="[overflow-wrap:anywhere]">
                      {record.name}
                    </bdi>
                  </button>
                  <span className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                    <bdi dir="auto">{record.code}</bdi>
                    {category != null && <bdi dir="auto">{category}</bdi>}
                  </span>
                  {kits.length > 0 && (
                    <span className="block text-xs text-muted-foreground">
                      <span className="me-1">{kitWords.kit}</span>
                      <bdi>{kits.map(({ name }) => name).join(" · ")}</bdi>
                    </span>
                  )}
                </th>
                <td className={cell}>
                  <span>{t[record.tracking]}</span>
                  {individual && record.serial !== null && (
                    <bdi dir="auto" className="block text-xs text-muted-foreground">
                      {record.serial}
                    </bdi>
                  )}
                </td>
                <td className={`${cell} max-w-56 [overflow-wrap:anywhere]`}>
                  <bdi dir="auto">{location}</bdi>
                  <bdi dir="auto" className="block text-xs text-muted-foreground">
                    {sites.get(record.siteId)}
                  </bdi>
                </td>
                {hasCustody && (
                  <td className={`${cell} max-w-48 [overflow-wrap:anywhere]`}>
                    <RegisterHolder
                      record={record}
                      holdings={holdingRows}
                      number={number}
                      words={custodyWords}
                    />
                  </td>
                )}
                <td className={`${cell} text-end tabular-nums`}>
                  {number === null ? quantity : number.format(quantity)}
                </td>
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
