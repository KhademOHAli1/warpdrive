import { useHydrated } from "@/lib/useHydrated";
import type { AssetRecord, AssetsWorkspace } from "../contracts";
import type { AssetWords } from "./assetMessages";

const header = "px-3 py-2.5 font-medium text-muted-foreground";
const cell = "px-3 py-2.5 align-middle";

export function AssetTable({
  records,
  workspace,
  locationLabels,
  selectedId,
  onSelect,
  locale,
  words: t,
}: {
  records: AssetRecord[];
  workspace: AssetsWorkspace;
  locationLabels: ReadonlyMap<string, string>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  locale: string;
  words: AssetWords;
}) {
  const number = useHydrated() ? new Intl.NumberFormat(locale) : null;
  const sites = new Map(workspace.sites.map(({ id, name }) => [id, name]));
  const categories = new Map(workspace.categories.map(({ id, name }) => [id, name]));
  return (
    <div className="min-w-0 overflow-x-auto rounded-lg border bg-card">
      <table aria-label={t.register} className="w-full min-w-[31rem] border-collapse text-sm">
        <thead className="border-b bg-muted/40">
          <tr>
            <th scope="col" className={`${header} text-start`}>
              {t.name}
            </th>
            <th scope="col" className={`${header} text-start`}>
              {t.tracking}
            </th>
            <th scope="col" className={`${header} text-start`}>
              {t.location}
            </th>
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

            return (
              <tr
                key={record.id}
                data-selected={record.id === selectedId}
                className="hover:bg-muted/40 data-[selected=true]:bg-accent/75"
              >
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
