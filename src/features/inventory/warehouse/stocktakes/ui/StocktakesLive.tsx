"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { PageHeading } from "@/components/shell/PageHeading";
import { Button } from "@/components/ui/Button";
import { PILL_TAB, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { trpc } from "@/lib/trpc-client";
import { readCsrfToken } from "@/utils/csrfCookie";
import { CatalogField, CatalogSelect } from "../../../catalog/ui/CatalogFields";
import type {
  StocktakeError,
  StocktakeIntent,
  StocktakeQuery,
  StocktakeResult,
  StocktakeSite,
  StocktakeWorkspace,
} from "../contracts";
import { executeStocktakeAction } from "./actions";
import { type StocktakeMessages, stocktakeMessages } from "./messages";
import { StocktakeEditors } from "./StocktakeEditors";
import { CountsView, ValuationsView } from "./StocktakesView";
import {
  type OpenStocktakeEditor,
  type StocktakeDialogProps,
  type StocktakeEditor,
  stocktakeHref,
} from "./types";

function canEdit(workspace: StocktakeWorkspace, site: StocktakeSite, editor: StocktakeEditor) {
  switch (editor.type) {
    case "captureValuation":
      return site.canCaptureValues && workspace.valuationAccess !== undefined;
    case "startCount":
      return site.canCount && workspace.locations.length > 0;
    case "recordCounts":
    case "reconcileCount":
    case "cancelCount":
      return (
        site.canCount &&
        workspace.stocktake?.id === editor.stocktake.id &&
        workspace.stocktake.status === "draft"
      );
  }
}

function StocktakeWorkspaceContent({
  workspace,
  site,
  busy,
  open,
  queryScope,
  selectSite,
  t,
}: {
  workspace: StocktakeWorkspace;
  site: StocktakeSite;
  busy: boolean;
  open: OpenStocktakeEditor;
  queryScope: StocktakeQuery;
  selectSite: (siteId: string) => void;
  t: StocktakeMessages;
}) {
  const [requestedTab, setRequestedTab] = useState<"counts" | "valuations">(() =>
    queryScope.valuationId !== undefined || !site.canReadCounts ? "valuations" : "counts",
  );
  const access = workspace.valuationAccess;
  const tab =
    (requestedTab === "valuations" && access !== undefined) || !site.canReadCounts
      ? "valuations"
      : "counts";
  return (
    <div className="space-y-3">
      <div className="max-w-64">
        <CatalogField label={t.site}>
          <CatalogSelect
            ariaLabel={t.site}
            value={site.id}
            options={workspace.sites.map((row) => ({
              value: row.id,
              label: `${row.name} · ${row.code}${row.archived ? ` · ${t.archived}` : ""}`,
            }))}
            onChange={selectSite}
            disabled={busy}
          />
        </CatalogField>
      </div>
      <Tabs
        value={tab}
        onValueChange={(value) => {
          if (value === "counts" || value === "valuations") setRequestedTab(value);
        }}
      >
        <TabsList
          aria-label={t.title}
          className="inline-flex w-fit max-w-full flex-wrap gap-1 rounded-lg border bg-card p-0.5"
        >
          {site.canReadCounts && (
            <TabsTrigger value="counts" className={PILL_TAB}>
              {t.counts}
            </TabsTrigger>
          )}
          {access !== undefined && (
            <TabsTrigger value="valuations" className={PILL_TAB}>
              {t.valuations}
            </TabsTrigger>
          )}
        </TabsList>
        {site.canReadCounts && (
          <TabsContent value="counts">
            <CountsView {...{ workspace, site, busy, open, t }} />
          </TabsContent>
        )}
        {access !== undefined && (
          <TabsContent value="valuations">
            <ValuationsView {...{ access, site, busy, open, t }} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

export function StocktakesLive({
  actorId,
  queryScope,
  initial,
}: {
  actorId: string;
  queryScope: StocktakeQuery;
  initial: StocktakeResult;
}) {
  const t = stocktakeMessages[useLocale()];
  const router = useRouter();
  const [navigating, transition] = useTransition();
  const [editor, setEditor] = useState<StocktakeEditor | null>(null);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<StocktakeError | "transport" | null>(null);
  const active = useRef(false);
  const attempted = useRef<{ intent: string; requestId: string } | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const actions = useRef<HTMLDivElement | null>(null);
  const utils = trpc.useUtils();
  const query = trpc.inventory.warehouse.stocktakes.workspace.useQuery(queryScope, {
    initialData: initial,
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: "always",
  });
  const workspace = !query.isError && query.data.ok ? query.data.value : null;
  const site = workspace?.sites.find(({ id }) => id === workspace.selectedSiteId);
  const editorVisible =
    workspace !== null && site !== undefined && editor !== null && canEdit(workspace, site, editor);
  const busy = pending || navigating || query.isFetching;

  const open: OpenStocktakeEditor = (event, next) => {
    trigger.current = event.currentTarget;
    setSaved(false);
    setError(null);
    setEditor(next);
  };

  async function save(intent: StocktakeIntent) {
    if (active.current || site === undefined) return;
    active.current = true;
    setPending(true);
    setError(null);
    const serialized = JSON.stringify(intent);
    const requestId =
      attempted.current?.intent === serialized ? attempted.current.requestId : crypto.randomUUID();
    attempted.current = { intent: serialized, requestId };
    try {
      const result = await executeStocktakeAction(
        actorId,
        { ...intent, requestId },
        readCsrfToken(),
      );
      attempted.current = null;
      if (!result.ok) {
        setError(result.error);
        if (result.error === "stale" || result.error === "unavailable") void query.refetch();
        return;
      }

      setEditor(null);
      setSaved(true);
      void utils.inventory.warehouse.stocktakes.workspace.invalidate();
      if (intent.type === "reconcileCount") {
        void utils.inventory.warehouse.workspace.invalidate();
        void utils.inventory.warehouse.history.invalidate();
        void utils.inventory.workspace.invalidate();
      }
      if (intent.type === "startCount" || intent.type === "captureValuation") {
        const detail =
          intent.type === "startCount" ? { stocktakeId: result.id } : { valuationId: result.id };
        transition(() => router.push(stocktakeHref(site.id, detail)));
      }
    } catch {
      setError("transport");
    } finally {
      active.current = false;
      setPending(false);
    }
  }

  const dialog: StocktakeDialogProps = {
    pending,
    error: error === null ? null : t[error],
    close: () => setEditor(null),
    restoreFocus: () => {
      if (trigger.current?.isConnected === true) trigger.current.focus();
      else actions.current?.focus();
    },
    save: (intent) => void save(intent),
  };

  return (
    <main
      className={`${BLOCK_CLASS} ph-no-capture min-w-0 pb-4`}
      aria-busy={busy}
      data-stocktakes-workspace
    >
      <PageHeading
        title={t.title}
        crumbs={[{ label: t.warehouse, href: "/inventory/warehouse" }, { label: t.title }]}
        actions={
          <div ref={actions} tabIndex={-1}>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void query.refetch()}
            >
              <RefreshCw aria-hidden="true" />
              {t.refresh}
            </Button>
          </div>
        }
      />
      {workspace === null ? (
        <p role="alert" className="rounded-lg border bg-card p-4 text-sm text-destructive">
          {query.data.ok ? t.unavailable : t[query.data.error]}
        </p>
      ) : (
        <>
          {saved && (
            <p className="mb-3 text-sm text-muted-foreground" role="status">
              {t.saved}
            </p>
          )}
          {error !== null && !editorVisible && (
            <p className="mb-3 text-sm text-destructive" role="alert">
              {t[error]}
            </p>
          )}
          {site === undefined ? (
            <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
              {t.noSites}
            </p>
          ) : (
            <>
              <StocktakeWorkspaceContent
                {...{ workspace, site, busy, open, queryScope, t }}
                selectSite={(siteId) => {
                  if (site.id !== siteId) transition(() => router.push(stocktakeHref(siteId)));
                }}
              />
              {editor !== null && editorVisible && (
                <StocktakeEditors {...{ editor, workspace, dialog, t }} siteId={site.id} />
              )}
            </>
          )}
        </>
      )}
    </main>
  );
}
