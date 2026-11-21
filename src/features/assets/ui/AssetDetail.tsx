import { Archive, ArrowLeftRight, NotebookPen, Pencil, RotateCcw } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import type { AssetField, AssetRecord, AssetsWorkspace, AssetValue } from "../contracts";
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
  number: Intl.NumberFormat,
  t: AssetWords,
) {
  if (typeof value === "number") return number.format(value);
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

export function AssetDetail({
  record,
  workspace,
  locationLabels,
  busy,
  onEdit,
  locale,
  words: t,
}: {
  record: AssetRecord;
  workspace: AssetsWorkspace;
  locationLabels: ReadonlyMap<string, string>;
  busy: boolean;
  onEdit: (event: MouseEvent<HTMLButtonElement>, editor: AssetEditor) => void;
  locale: string;
  words: AssetWords;
}) {
  const number = new Intl.NumberFormat(locale);
  const timestamp = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  });
  const site = workspace.sites.find(({ id }) => id === record.siteId);
  const category = workspace.categories.find(({ id }) => id === record.categoryId);
  const archived = record.archivedAt !== null;
  const individual = record.tracking === "individual";
  const model = individual ? workspace.models.find(({ id }) => id === record.modelId) : undefined;
  const balances = individual ? [] : record.balances.filter(({ quantity }) => quantity > 0);
  const total = balances.reduce((sum, bin) => sum + bin.quantity, 0);
  const events = [...record.events].reverse().sort((a, b) => b.at.localeCompare(a.at));

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
            <DetailItem label={t.totalQuantity} value={number.format(total)} />
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
                  value={fieldDisplay(field, record.fieldValues[field.id], number, t)}
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
                    <td className="py-1.5 text-end tabular-nums">{number.format(quantity)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

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
                          {number.format(event.quantity)}
                        </span>
                      )}
                    </p>
                    <time dateTime={event.at} className="text-xs text-muted-foreground">
                      {timestamp.format(new Date(event.at))}
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
