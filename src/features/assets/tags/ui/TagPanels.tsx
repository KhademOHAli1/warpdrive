"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Button, buttonVariants } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { formatDateTime } from "@/lib/localeFormatting";
import { useHydrated } from "@/lib/useHydrated";
import type {
  AssetTagBatch,
  AssetTagBindingEvent,
  AssetTagOwnerMessage,
  AssetTagRecord,
  AssetTagScan,
  AssetTagTarget,
} from "../contracts";
import { assetTagText } from "../tagCodes";
import type { TagEditor } from "./TagEditors";
import type { AssetTagWords } from "./tagMessages";

const cell = "px-3 py-2.5 text-start align-top";
const header = `${cell} text-xs font-medium text-muted-foreground`;
const empty = "rounded-lg border bg-card p-4 text-sm text-muted-foreground";
const eventLabels = {
  claim: "eventClaim",
  unlink: "eventUnlink",
  swap: "eventSwap",
  import: "eventImport",
  owner_contact: "eventOwnerContact",
} as const;

function TagTime({ value }: { value: string }) {
  const hydrated = useHydrated();
  const preferences = useLocalePreferences();
  return (
    <time dateTime={value}>
      {hydrated ? formatDateTime(value, preferences) : value.slice(0, 10)}
    </time>
  );
}

export function TagsTable({
  rows,
  batches,
  activeId,
  selected,
  choose,
  toggle,
  words: t,
}: {
  rows: AssetTagRecord[];
  batches: ReadonlyMap<string, AssetTagBatch>;
  activeId: string | null;
  selected: ReadonlySet<string>;
  choose: (id: string) => void;
  toggle: (ids: string[], next: boolean) => void;
  words: AssetTagWords;
}) {
  if (rows.length === 0) return <p className={empty}>{t.empty}</p>;
  const selectedCount = rows.filter(({ id }) => selected.has(id)).length;
  const all = selectedCount === rows.length;
  return (
    <div className="min-w-0 overflow-x-auto rounded-lg border bg-card">
      <table aria-label={t.register} className="w-full min-w-[31rem] border-collapse text-sm">
        <thead className="border-b bg-muted/35">
          <tr>
            <th scope="col" className={header}>
              <Checkbox
                label={t.printSelectAll}
                checked={selectedCount === 0 ? false : all || "indeterminate"}
                onCheckedChange={(checked) =>
                  toggle(
                    rows.map(({ id }) => id),
                    checked,
                  )
                }
              />
            </th>
            <th scope="col" className={header}>
              {t.tag}
            </th>
            <th scope="col" className={header}>
              {t.batch}
            </th>
            <th scope="col" className={header}>
              {t.stateFilter}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((tag) => {
            const code = assetTagText(tag.token);
            return (
              <tr
                key={tag.id}
                data-asset-tag-row={tag.id}
                className={activeId === tag.id ? "bg-muted/50" : undefined}
              >
                <td className={cell}>
                  <Checkbox
                    label={t.printSelect.replace("{code}", () => code)}
                    checked={selected.has(tag.id)}
                    onCheckedChange={(checked) => toggle([tag.id], checked)}
                  />
                </td>
                <th scope="row" className={cell}>
                  <button
                    type="button"
                    aria-pressed={activeId === tag.id}
                    onClick={() => choose(tag.id)}
                    className="max-w-56 rounded text-start font-mono text-xs font-medium underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring [overflow-wrap:anywhere]"
                  >
                    <bdi dir="ltr">{code}</bdi>
                  </button>
                  {tag.legacy !== null && (
                    <span className="mt-1 block text-xs font-normal text-muted-foreground">
                      {t.legacy} <bdi dir="ltr">{tag.legacy.id}</bdi>
                    </span>
                  )}
                </th>
                <td className={cell}>
                  <bdi>{batches.get(tag.batchId)?.title}</bdi>
                </td>
                <td className={cell}>
                  {tag.assignment === null ? (
                    <Badge variant="outline">{t.unassigned}</Badge>
                  ) : (
                    <div>
                      <bdi className="font-medium">{tag.assignment.target.title}</bdi>
                      <p className="text-xs text-muted-foreground">
                        {t[tag.assignment.target.kind]}
                      </p>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

type OpenTag = (button: HTMLElement, editor: TagEditor) => void;

function BindingHistory({
  events,
  targets,
  words: t,
}: {
  events: AssetTagBindingEvent[];
  targets: AssetTagTarget[];
  words: AssetTagWords;
}) {
  const history = [...events].sort((a, b) => b.at.localeCompare(a.at));
  return (
    <section aria-label={t.history} className="space-y-2 border-t pt-3">
      <h3 className="text-sm font-semibold">{t.history}</h3>
      {history.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t.noHistory}</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {history.map((item) => {
            const target = targets.find(
              ({ id, kind }) => id === item.target.id && kind === item.target.kind,
            );
            return (
              <li
                key={item.id}
                data-asset-tag-event={item.kind}
                className="space-y-1 px-3 py-2 text-xs"
              >
                <div className="flex flex-wrap justify-between gap-1">
                  <span className="font-medium">{t[eventLabels[item.kind]]}</span>
                  <span className="text-muted-foreground">
                    <TagTime value={item.at} />
                  </span>
                </div>
                {target !== undefined && (
                  <p>
                    <bdi>{target.title}</bdi>
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function TagActions({
  tag,
  busy,
  canManage,
  canSwap,
  open,
  words: t,
}: {
  tag: AssetTagRecord;
  busy: boolean;
  canManage: boolean;
  canSwap: boolean;
  open: OpenTag;
  words: AssetTagWords;
}) {
  if (!canManage) return null;
  const { assignment } = tag;
  if (assignment === null) {
    return (
      <Button
        size="sm"
        disabled={busy}
        onClick={(event) => open(event.currentTarget, { type: "claim", tagId: tag.id })}
      >
        {t.claim}
      </Button>
    );
  }
  if (!assignment.target.canManage) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {canSwap && (
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={(event) => open(event.currentTarget, { type: "swap", tagId: tag.id })}
        >
          {t.swap}
        </Button>
      )}
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={(event) => open(event.currentTarget, { type: "setOwnerContact", tagId: tag.id })}
      >
        {assignment.ownerContact ? t.disableContact : t.enableContact}
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={(event) => open(event.currentTarget, { type: "unlink", tagId: tag.id })}
      >
        {t.unlink}
      </Button>
    </div>
  );
}

export function TagDetail({
  tag,
  batch,
  targets,
  events,
  busy,
  canManage,
  canSwap,
  open,
  words: t,
}: {
  tag: AssetTagRecord;
  batch: AssetTagBatch | undefined;
  targets: AssetTagTarget[];
  events: AssetTagBindingEvent[];
  busy: boolean;
  canManage: boolean;
  canSwap: boolean;
  open: OpenTag;
  words: AssetTagWords;
}) {
  const { assignment } = tag;
  const href = assignment?.target.href;
  return (
    <section
      aria-label={t.detail}
      data-asset-tag-detail={tag.id}
      className="min-w-0 space-y-3 rounded-lg border bg-card p-4"
    >
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">{t.detail}</h2>
        <bdi dir="ltr" className="font-mono text-xs text-muted-foreground [overflow-wrap:anywhere]">
          {assetTagText(tag.token)}
        </bdi>
      </div>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        {batch !== undefined && (
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">{t.batch}</dt>
            <dd className="[overflow-wrap:anywhere]">
              <bdi>{batch.title}</bdi>
            </dd>
          </div>
        )}
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">{t.stateFilter}</dt>
          <dd>{assignment === null ? t.unassigned : t.assigned}</dd>
        </div>
        {tag.legacy !== null && (
          <div className="col-span-2">
            <dt className="text-xs text-muted-foreground">{t.legacy}</dt>
            <dd className="[overflow-wrap:anywhere]">
              <bdi dir="ltr">{tag.legacy.id}</bdi>
            </dd>
          </div>
        )}
        {assignment !== null && (
          <>
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">{t.target}</dt>
              <dd className="[overflow-wrap:anywhere]">
                <bdi>{assignment.target.title}</bdi>
                {assignment.target.subtitle !== null && (
                  <p className="text-xs text-muted-foreground">
                    <bdi>{assignment.target.subtitle}</bdi>
                  </p>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t.ownerContact}</dt>
              <dd>{assignment.ownerContact ? t.on : t.off}</dd>
            </div>
          </>
        )}
      </dl>
      {href != null && (
        <Link href={href} className={buttonVariants({ variant: "outline", size: "sm" })}>
          {t.openTarget}
        </Link>
      )}
      <TagActions {...{ tag, busy, canManage, canSwap, open, words: t }} />
      <BindingHistory {...{ events, targets, words: t }} />
    </section>
  );
}

export function SiteScans({
  scans,
  tags,
  canManage,
  words: t,
}: {
  scans: AssetTagScan[];
  tags: ReadonlyMap<string, AssetTagRecord>;
  canManage: boolean;
  words: AssetTagWords;
}) {
  if (scans.length === 0) return <p className={empty}>{t.noScans}</p>;
  return (
    <div className="min-w-0 overflow-x-auto rounded-lg border bg-card">
      <table aria-label={t.scans} className="w-full min-w-[28rem] border-collapse text-sm">
        <thead className="border-b bg-muted/35">
          <tr>
            <th scope="col" className={header}>
              {t.tag}
            </th>
            <th scope="col" className={header}>
              {t.scannedAt}
            </th>
            <th scope="col" className={header}>
              {t.scanSource}
            </th>
            {canManage && (
              <th scope="col" className={header}>
                {t.coordinates}
              </th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y">
          {[...scans]
            .sort((a, b) => b.at.localeCompare(a.at))
            .map((scan) => {
              const tag = tags.get(scan.tagId);
              if (tag === undefined) return null;
              const { coordinates } = scan;
              return (
                <tr key={scan.id} data-asset-tag-scan={scan.id}>
                  <th
                    scope="row"
                    className={`${cell} font-mono text-xs font-medium [overflow-wrap:anywhere]`}
                  >
                    <bdi dir="ltr">{assetTagText(tag.token)}</bdi>
                  </th>
                  <td className={cell}>
                    <TagTime value={scan.at} />
                  </td>
                  <td className={cell}>{t[scan.source]}</td>
                  {canManage && (
                    <td className={cell}>
                      {coordinates === null ? (
                        t.noCoordinates
                      ) : (
                        <bdi dir="ltr">
                          {coordinates.latitude}, {coordinates.longitude} · ±{coordinates.accuracy}{" "}
                          {t.meter}
                        </bdi>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
        </tbody>
      </table>
    </div>
  );
}

export function OwnerInbox({
  messages,
  tags,
  busy,
  mark,
  words: t,
}: {
  messages: AssetTagOwnerMessage[];
  tags: ReadonlyMap<string, AssetTagRecord>;
  busy: boolean;
  mark: (messageId: string) => void;
  words: AssetTagWords;
}) {
  if (messages.length === 0) return <p className={empty}>{t.noMessages}</p>;
  return (
    <ul aria-label={t.messages} className="divide-y rounded-lg border bg-card">
      {[...messages]
        .sort((a, b) => b.at.localeCompare(a.at))
        .map((message) => {
          const tag = tags.get(message.tagId);
          if (tag === undefined) return null;
          return (
            <li
              key={message.id}
              data-asset-tag-message={message.id}
              className="space-y-2 p-4 text-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex flex-wrap items-center gap-2">
                  <bdi dir="ltr" className="font-mono text-xs">
                    {assetTagText(tag.token)}
                  </bdi>
                  <Badge variant="outline">{message.readAt === null ? t.unread : t.read}</Badge>
                </span>
                <span className="text-xs text-muted-foreground">
                  <TagTime value={message.at} />
                </span>
              </div>
              <p className="whitespace-pre-wrap [overflow-wrap:anywhere] [unicode-bidi:plaintext]">
                {message.message}
              </p>
              {message.replyTo !== null && (
                <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                  {t.replyTo} <bdi dir="ltr">{message.replyTo}</bdi>
                </p>
              )}
              {message.readAt === null && (
                <Button
                  size="sm"
                  variant="outline"
                  type="button"
                  disabled={busy}
                  onClick={() => mark(message.id)}
                >
                  {t.markRead}
                </Button>
              )}
            </li>
          );
        })}
    </ul>
  );
}
