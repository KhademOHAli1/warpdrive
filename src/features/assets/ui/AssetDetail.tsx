import { Archive, ArrowLeftRight, NotebookPen, Pencil, RotateCcw } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { useHydrated } from "@/lib/useHydrated";
import type { AssetField, AssetRecord, AssetSite, AssetsWorkspace, AssetValue } from "../contracts";
import type { CustodyOpener } from "../custody/ui/CustodyDialogs";
import { AssetCustodyPanel } from "../custody/ui/CustodyPanels";
import type { CustodyWords } from "../custody/ui/messages";
import { KitAssociations } from "../kits/ui/KitsRegister";
import { type KitWords, kitMessages } from "../kits/ui/messages";
import { kitAssetUsage, kitUsesAsset } from "../kits/usage";
import type { AssetMediaAccess } from "../media/contracts";
import { AssetMediaCover, AssetMediaPanel } from "../media/ui/AssetMedia";
import { useAssetMedia } from "../media/ui/useAssetMedia";
import type { AssetEditor } from "./AssetEditors";
import type { AssetWords } from "./assetMessages";

function DetailItem({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 [overflow-wrap:anywhere]">
        <bdi dir="auto">{value ?? "—"}</bdi>
      </dd>
    </div>
  );
}

function fieldDisplay(
  field: AssetField,
  value: AssetValue | undefined,
  formatNumber: (value: number) => string,
  t: AssetWords,
) {
  if (typeof value === "number") return formatNumber(value);
  if (typeof value === "boolean") return value ? t.yes : t.no;
  if (typeof value === "string" && field.type === "link" && /^https?:\/\//i.test(value)) {
    return (
      <a
        href={value}
        target="_blank"
        rel="noreferrer"
        className="underline underline-offset-2 hover:text-foreground"
      >
        {value}
      </a>
    );
  }
  return value;
}

function custodyWordsForKit(words: CustodyWords, kitWords: KitWords, held: boolean) {
  return held
    ? { ...words, currentHolder: kitWords.looseCustody, noHolder: kitWords.noLooseCustody }
    : words;
}

function canEditActiveAsset(site: AssetSite | undefined, record: AssetRecord) {
  return site?.canManage === true && record.archivedAt === null;
}

export function AssetDetail({
  record,
  workspace,
  locationLabels,
  busy: registerBusy,
  onEdit,
  locale,
  words: t,
  custodyWords,
  openCustody,
  mediaAccess,
}: {
  record: AssetRecord;
  workspace: AssetsWorkspace;
  locationLabels: ReadonlyMap<string, string>;
  busy: boolean;
  onEdit: (event: MouseEvent<HTMLButtonElement>, editor: AssetEditor) => void;
  locale: string;
  words: AssetWords;
  custodyWords: CustodyWords;
  openCustody?: CustodyOpener;
  mediaAccess?: AssetMediaAccess;
}) {
  const kitWords = kitMessages[useLocale()];
  const hydrated = useHydrated();
  const number = hydrated ? new Intl.NumberFormat(locale) : null;
  const timestamp = hydrated
    ? new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "UTC",
      })
    : null;
  const site = workspace.sites.find(({ id }) => id === record.siteId);
  const category = workspace.categories.find(({ id }) => id === record.categoryId);
  const archived = record.archivedAt !== null;
  const held = workspace.custody?.holdings.some(({ assetId }) => assetId === record.id) === true;
  const individual = record.tracking === "individual";
  const inKit = kitUsesAsset(workspace.kits, record.id);
  const kitHeld = kitAssetUsage(workspace.kits, record.id).held > 0;
  const canMoveLoose = !individual || (!held && !inKit);
  const canArchive = !held && !inKit;
  const canManageMedia = canEditActiveAsset(site, record);
  const ordinaryCustody = canManageMedia && (!individual || !inKit);
  const model = individual ? workspace.models.find(({ id }) => id === record.modelId) : undefined;
  const media = useAssetMedia(
    mediaAccess,
    { type: "asset", id: record.id },
    `${record.version}:${archived}:${canManageMedia}:${model?.id ?? ""}:${model?.version ?? ""}`,
  );
  const busy = registerBusy || media.pending;
  const balances = individual ? [] : record.balances.filter(({ quantity }) => quantity > 0);
  const total = balances.reduce((sum, bin) => sum + bin.quantity, 0);
  const events = [...record.events].reverse().sort((a, b) => b.at.localeCompare(a.at));

  function formatNumber(value: number) {
    return number === null ? String(value) : number.format(value);
  }

  function formatTimestamp(value: string) {
    return timestamp === null ? value.slice(0, 10) : timestamp.format(new Date(value));
  }

  function location(id: string | null) {
    return id === null ? t.unassigned : (locationLabels.get(id) ?? "—");
  }

  return (
    <section
      id="asset-register-detail"
      aria-label={t.details}
      className="min-w-0 divide-y rounded-lg border bg-card text-sm"
    >
      <div className="space-y-3 p-4">
        <div>
          <p className="text-xs font-medium text-muted-foreground">
            <bdi dir="auto">{record.code}</bdi>
          </p>
          <h2 className="mt-0.5 text-lg font-semibold leading-snug [overflow-wrap:anywhere]">
            <bdi dir="auto">{record.name}</bdi>
          </h2>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge variant="outline">{t[record.tracking]}</Badge>
            <Badge variant="outline">{archived ? t.archived : t.active}</Badge>
          </div>
        </div>
        <AssetMediaCover state={media} />
        {record.description !== null && (
          <p className="whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]">
            <bdi dir="auto">{record.description}</bdi>
          </p>
        )}
        {site?.canManage === true && (
          <div className="flex flex-wrap gap-2">
            {!archived && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={(event) => onEdit(event, { type: "update", asset: record })}
                >
                  <Pencil aria-hidden="true" size={14} />
                  {t.editAsset}
                </Button>
                {canMoveLoose && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={(event) =>
                      onEdit(event, { type: individual ? "move" : "changePool", asset: record })
                    }
                  >
                    <ArrowLeftRight aria-hidden="true" size={14} />
                    {individual ? t.move : t.changePool}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={(event) => onEdit(event, { type: "note", asset: record })}
                >
                  <NotebookPen aria-hidden="true" size={14} />
                  {t.addNote}
                </Button>
              </>
            )}
            {canArchive && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={(event) => onEdit(event, { type: "setArchive", asset: record })}
              >
                {archived ? (
                  <RotateCcw aria-hidden="true" size={14} />
                ) : (
                  <Archive aria-hidden="true" size={14} />
                )}
                {archived ? t.reinstate : t.archive}
              </Button>
            )}
          </div>
        )}
      </div>
      <div className="space-y-4 p-4">
        <dl className="grid grid-cols-2 gap-3">
          <DetailItem label={t.site} value={site?.name} />
          <DetailItem label={t.category} value={category?.name} />
          {individual ? (
            <>
              <DetailItem label={t.serial} value={record.serial} />
              <DetailItem label={t.model} value={model?.name} />
              <DetailItem label={t.location} value={location(record.locationId)} />
            </>
          ) : (
            <DetailItem label={t.totalQuantity} value={formatNumber(total)} />
          )}
        </dl>

        {record.tags.length > 0 && (
          <div>
            <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">{t.tags}</h3>
            <ul className="flex flex-wrap gap-1.5">
              {record.tags.map((tag) => (
                <li key={tag}>
                  <Badge variant="outline">
                    <bdi dir="auto">{tag}</bdi>
                  </Badge>
                </li>
              ))}
            </ul>
          </div>
        )}

        {category && category.fields.length > 0 && (
          <div>
            <h3 className="mb-2 font-semibold">{t.fieldValues}</h3>
            <dl className="grid grid-cols-2 gap-3">
              {category.fields.map((field) => (
                <DetailItem
                  key={field.id}
                  label={field.label}
                  value={fieldDisplay(field, record.fieldValues[field.id], formatNumber, t)}
                />
              ))}
            </dl>
          </div>
        )}
      </div>

      {!individual && (
        <div className="p-4">
          <h3 className="mb-2 font-semibold">{t.balances}</h3>
          {balances.length === 0 ? (
            <p className="text-muted-foreground">{t.noBalances}</p>
          ) : (
            <table aria-label={t.balances} className="w-full text-sm">
              <thead className="border-b text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="py-1.5 text-start font-medium">
                    {t.location}
                  </th>
                  <th scope="col" className="py-1.5 text-end font-medium">
                    {t.quantity}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {balances.map(({ locationId, quantity }) => (
                  <tr key={locationId}>
                    <th
                      scope="row"
                      className="py-1.5 text-start font-normal [overflow-wrap:anywhere]"
                    >
                      <bdi dir="auto">{location(locationId)}</bdi>
                    </th>
                    <td className="py-1.5 text-end tabular-nums">{formatNumber(quantity)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <KitAssociations workspace={workspace} assetId={record.id} />

      {workspace.custody !== undefined && (
        <AssetCustodyPanel
          record={record}
          custody={workspace.custody}
          display={{ time: formatTimestamp, number: formatNumber, location }}
          busy={busy}
          open={ordinaryCustody ? openCustody : undefined}
          words={custodyWordsForKit(custodyWords, kitWords, kitHeld)}
        />
      )}

      <AssetMediaPanel
        state={media}
        busy={registerBusy}
        canManage={canManageMedia}
        className="p-4"
      />

      <div className="p-4">
        <h3 className="mb-2 font-semibold">{t.history}</h3>
        {events.length === 0 ? (
          <p className="text-muted-foreground">{t.noHistory}</p>
        ) : (
          <ol className="divide-y">
            {events.map((event) => {
              const label = event.kind === "archived" ? t.archivedEvent : t[event.kind];
              return (
                <li key={event.id} className="space-y-1 py-2 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                    <p className="font-medium">
                      {label}
                      {event.quantity !== null && (
                        <span className="ms-2 text-muted-foreground tabular-nums">
                          {formatNumber(event.quantity)}
                        </span>
                      )}
                    </p>
                    <time dateTime={event.at} className="text-xs text-muted-foreground">
                      {formatTimestamp(event.at)}
                    </time>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    <bdi dir="auto">{event.actor}</bdi>
                  </p>
                  {event.kind === "moved" ? (
                    <dl className="grid grid-cols-2 gap-2 text-xs">
                      <DetailItem label={t.movedFrom} value={location(event.fromLocationId)} />
                      <DetailItem label={t.movedTo} value={location(event.locationId)} />
                    </dl>
                  ) : (
                    event.locationId !== null && (
                      <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                        <bdi dir="auto">{location(event.locationId)}</bdi>
                      </p>
                    )
                  )}
                  {event.reason !== null && (
                    <p className="whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]">
                      <bdi dir="auto">{event.reason}</bdi>
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}
