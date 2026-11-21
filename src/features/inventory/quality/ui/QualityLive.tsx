"use client";

import { RefreshCw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { PageHeading } from "@/components/shell/PageHeading";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { trpc } from "@/lib/trpc-client";
import { readCsrfToken } from "@/utils/csrfCookie";
import { CatalogField, CatalogSelect } from "../../catalog/ui/CatalogFields";
import type {
  QualityQuery,
  QualityTargetStatus,
  QualityWorkspace,
  QualityWorkspaceResult,
} from "../contracts";
import { executeInventoryQualityAction } from "../webActions";
import { InspectionTarget, QualityStatus } from "./InspectionTarget";
import type { InspectionMessages } from "./inspectionMessages";
import { inspectionMessages } from "./inspectionMessages";

function qualityHref({ siteId, targetId }: QualityQuery = {}) {
  const search = new URLSearchParams();
  if (siteId !== undefined) search.set("siteId", siteId);
  if (targetId !== undefined) search.set("targetId", targetId);
  return search.size === 0 ? "/inventory/quality" : `/inventory/quality?${search.toString()}`;
}

const statuses: QualityTargetStatus[] = ["pending", "failed", "passed"];

function InspectionQueue({
  workspace,
  scope,
  selectSite,
  busy,
  t,
}: {
  workspace: QualityWorkspace;
  scope: QualityQuery;
  selectSite: (siteId: string | undefined) => void;
  busy: boolean;
  t: InspectionMessages;
}) {
  const searchId = useId();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<QualityTargetStatus | "">("");
  const needle = search.trim().toLowerCase();
  const sites = new Map(workspace.sites.map((site) => [site.id, site]));
  const visible = workspace.targets.filter((target) => {
    if (status !== "" && target.status !== status) return false;
    return [target.serial, target.lot, target.partCode, target.partName].some(
      (value) => value?.toLowerCase().includes(needle) === true,
    );
  });

  return (
    <section className="min-w-0 rounded-lg border bg-card" aria-labelledby="quality-queue">
      <div className="space-y-3 border-b p-3">
        <h2 id="quality-queue" className="text-sm font-semibold">
          {t.queue}
        </h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <CatalogField label={t.site}>
            <CatalogSelect
              ariaLabel={t.site}
              value={scope.siteId ?? ""}
              options={[
                { value: "", label: t.allSites },
                ...workspace.sites.map(({ id, code, name }) => ({
                  value: id,
                  label: `${code} · ${name}`,
                })),
              ]}
              onChange={(id) => selectSite(id || undefined)}
              disabled={busy}
            />
          </CatalogField>
          <CatalogField label={t.status}>
            <CatalogSelect
              ariaLabel={t.status}
              value={status}
              options={[
                { value: "", label: t.allStatuses },
                ...statuses.map((value) => ({ value, label: t[value] })),
              ]}
              onChange={(value) =>
                setStatus(statuses.find((candidate) => candidate === value) ?? "")
              }
            />
          </CatalogField>
        </div>
        <label className="sr-only" htmlFor={searchId}>
          {t.search}
        </label>
        <Input
          id={searchId}
          type="search"
          placeholder={t.search}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      {visible.length === 0 ? (
        <p className="p-3 text-sm text-muted-foreground" role="status">
          {t.empty}
        </p>
      ) : (
        <ul className="divide-y">
          {visible.map((target) => (
            <li key={target.id}>
              <Link
                href={qualityHref({ siteId: scope.siteId, targetId: target.id })}
                prefetch={false}
                aria-current={workspace.detail?.id === target.id ? "page" : undefined}
                className="block min-w-0 space-y-1 p-3 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50 aria-[current=page]:bg-accent"
                data-quality-target-link={target.id}
                data-quality-status={target.status}
              >
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <bdi className="text-sm font-medium [overflow-wrap:anywhere]">
                    {target.serial}
                  </bdi>
                  <QualityStatus status={target.status} t={t} />
                </span>
                <span className="block text-xs text-muted-foreground [overflow-wrap:anywhere]">
                  <bdi>
                    {target.partCode} · {target.partName}
                  </bdi>
                </span>
                <span className="flex flex-wrap gap-x-2 text-xs text-muted-foreground [overflow-wrap:anywhere]">
                  <bdi>{sites.get(target.siteId)?.name}</bdi>
                  {target.lot !== null && <bdi>{target.lot}</bdi>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function QualityLive({
  actorId,
  initial,
  scope,
}: {
  actorId: string;
  initial: QualityWorkspaceResult;
  scope: QualityQuery;
}) {
  const t = inspectionMessages[useLocale()];
  const router = useRouter();
  const utils = trpc.useUtils();
  const [navigating, transition] = useTransition();
  const [saved, setSaved] = useState(false);
  const query = trpc.inventory.quality.workspace.useQuery(scope, {
    initialData: initial,
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: "always",
  });
  const workspace = !query.isError && query.data.ok ? query.data.value : null;
  const busy = navigating || query.isFetching;

  async function afterSave() {
    setSaved(true);
    await Promise.all([
      utils.inventory.quality.workspace.invalidate(),
      utils.inventory.production.workspace.invalidate(),
      utils.inventory.warehouse.workspace.invalidate(),
      utils.inventory.workspace.invalidate(),
      utils.inventory.purchasing.workspace.invalidate(),
    ]);
  }

  return (
    <div
      className={`${BLOCK_CLASS} ph-no-capture min-w-0 pb-4`}
      aria-busy={busy}
      data-quality-workspace
    >
      <PageHeading
        title={t.title}
        crumbs={[{ label: t.inventory, href: "/inventory" }, { label: t.title }]}
        actions={
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void query.refetch()}
          >
            <RefreshCw aria-hidden="true" /> {t.refresh}
          </Button>
        }
      />
      {workspace === null ? (
        <div className="space-y-2 rounded-lg border bg-card p-4">
          <p role="alert" className="text-sm text-destructive">
            {t.unavailable}
          </p>
          {(scope.siteId !== undefined || scope.targetId !== undefined) && (
            <Link
              href={qualityHref()}
              prefetch={false}
              className="text-sm text-primary underline-offset-4 hover:underline"
            >
              {t.queue}
            </Link>
          )}
        </div>
      ) : (
        <>
          {saved && (
            <p role="status" className="mb-3 text-sm text-muted-foreground">
              {t.resultSaved}
            </p>
          )}
          <div className="grid min-w-0 items-start gap-3 xl:grid-cols-[minmax(17rem,22rem)_minmax(0,1fr)]">
            <InspectionQueue
              {...{ workspace, scope, t, busy }}
              selectSite={(siteId) => {
                if (scope.siteId !== siteId) transition(() => router.push(qualityHref({ siteId })));
              }}
            />
            {workspace.detail === null ? (
              <p className="rounded-lg border bg-card p-3 text-sm text-muted-foreground">
                {t.chooseTarget}
              </p>
            ) : (
              <InspectionTarget
                target={workspace.detail}
                siteName={workspace.sites.find(({ id }) => id === workspace.detail?.siteId)?.name}
                busy={busy}
                saved={afterSave}
                execute={(command) =>
                  executeInventoryQualityAction(actorId, command, readCsrfToken())
                }
                refresh={() => void query.refetch()}
                t={t}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}
