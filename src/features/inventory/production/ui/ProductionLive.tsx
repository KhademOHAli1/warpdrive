"use client";

import { Plus, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { PageHeading } from "@/components/shell/PageHeading";
import { Button } from "@/components/ui/Button";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { trpc } from "@/lib/trpc-client";
import { readCsrfToken } from "@/utils/csrfCookie";
import type {
  ProductionError,
  ProductionIntent,
  ProductionQuery,
  ProductionResult,
  ProductionWorkspace,
} from "../contracts";
import { executeProductionAction } from "./actions";
import { type ProductionMessages, productionMessages } from "./messages";
import { ProductionBuildView } from "./ProductionBuildView";
import { ProductionEditors } from "./ProductionEditors";
import { ProductionList } from "./ProductionList";
import {
  type OpenProductionEditor,
  type ProductionDialog,
  type ProductionEditor,
  productionCanPlan,
  productionHref,
} from "./types";

function commandMessage(t: ProductionMessages, error: ProductionError | "transport") {
  if (error === "project") return t.projectError;
  if (error === "serial") return t.serialError;
  return t[error];
}

function canOpenEditor(
  workspace: ProductionWorkspace,
  editor: ProductionEditor,
  scope: ProductionQuery,
) {
  if (editor.type === "createBuild") return productionCanPlan(workspace, scope.siteId);
  return workspace.detail?.canManage === true && workspace.detail.id === editor.build.id;
}

function initialEditor(
  initial: ProductionResult,
  { siteId, releaseId }: ProductionQuery,
): ProductionEditor | null {
  if (
    initial.ok &&
    releaseId !== undefined &&
    productionCanPlan(initial.value, siteId) &&
    initial.value.releases.some(({ id }) => id === releaseId)
  ) {
    return { type: "createBuild" };
  }
  return null;
}

export function ProductionLive({
  actorId,
  initialScope,
  initial,
}: {
  actorId: string;
  initialScope: ProductionQuery;
  initial: ProductionResult;
}) {
  const t = productionMessages[useLocale()];
  const router = useRouter();
  const [navigating, transition] = useTransition();
  const [editor, setEditor] = useState(() => initialEditor(initial, initialScope));
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<ProductionError | "transport" | null>(null);
  const active = useRef(false);
  const attempted = useRef<{ intent: string; requestId: string } | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const actions = useRef<HTMLDivElement | null>(null);
  const utils = trpc.useUtils();
  const query = trpc.inventory.production.workspace.useQuery(initialScope, {
    initialData: initial,
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: "always",
  });
  const result = query.data;
  const workspace = !query.isError && result.ok ? result.value : null;
  const busy = pending || navigating || query.isFetching;
  const editorVisible =
    workspace !== null && editor !== null && canOpenEditor(workspace, editor, initialScope);
  const editorStale =
    editorVisible &&
    editor.type !== "createBuild" &&
    editor.build.version !== workspace.detail?.version;

  const open: OpenProductionEditor = (event, next) => {
    trigger.current = event.currentTarget;
    setSaved(false);
    setError(null);
    setEditor(next);
  };

  async function save(intent: ProductionIntent) {
    if (active.current) return;
    const serialized = JSON.stringify(intent);
    if (editorStale && attempted.current?.intent !== serialized) {
      setError("stale");
      return;
    }
    active.current = true;
    setPending(true);
    setError(null);
    const requestId =
      attempted.current?.intent === serialized ? attempted.current.requestId : crypto.randomUUID();
    attempted.current = { intent: serialized, requestId };

    try {
      const effect = await executeProductionAction(
        actorId,
        { ...intent, requestId },
        readCsrfToken(),
      );
      attempted.current = null;
      if (!effect.ok) {
        setError(effect.error);
        if (effect.error === "stale" || effect.error === "unavailable") void query.refetch();
        return;
      }

      setEditor(null);
      setSaved(true);
      await Promise.all([
        utils.inventory.production.workspace.invalidate(),
        utils.inventory.warehouse.workspace.invalidate(),
        utils.inventory.workspace.invalidate(),
      ]);
      if (intent.type === "createBuild") {
        transition(() =>
          router.push(productionHref({ buildId: effect.value.buildId, siteId: intent.siteId })),
        );
      }
    } catch {
      setError("transport");
    } finally {
      active.current = false;
      setPending(false);
    }
  }

  const dialog: ProductionDialog = {
    pending,
    blocked: editorStale && error !== "transport",
    error:
      editorStale && error !== "transport"
        ? t.stale
        : error === null
          ? null
          : commandMessage(t, error),
    close: () => setEditor(null),
    restoreFocus: () => {
      if (trigger.current?.isConnected === true) trigger.current.focus();
      else actions.current?.focus();
    },
    save: (intent) => {
      void save(intent);
    },
  };

  return (
    <div
      className={`${BLOCK_CLASS} ph-no-capture min-w-0 pb-4`}
      aria-busy={busy}
      data-production-workspace
    >
      <PageHeading
        title={t.title}
        crumbs={[{ label: t.inventory, href: "/inventory" }, { label: t.title }]}
        actions={
          <div ref={actions} tabIndex={-1} className="flex min-w-0 flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void query.refetch()}
            >
              <RefreshCw aria-hidden="true" /> {t.refresh}
            </Button>
            {productionCanPlan(workspace, initialScope.siteId) && (
              <Button
                size="sm"
                disabled={busy}
                data-production-action="createBuild"
                onClick={(event) => open(event, { type: "createBuild" })}
              >
                <Plus aria-hidden="true" /> {t.planBuild}
              </Button>
            )}
          </div>
        }
      />
      {workspace === null ? (
        <div className="space-y-2 rounded-lg border bg-card p-4">
          <p role="alert" className="text-sm text-destructive">
            {!result.ok ? commandMessage(t, result.error) : t.unavailable}
          </p>
          {(initialScope.siteId !== undefined || initialScope.buildId !== undefined) && (
            <Link
              href={productionHref()}
              prefetch={false}
              className="text-sm text-primary underline-offset-4 hover:underline"
            >
              {t.builds}
            </Link>
          )}
        </div>
      ) : (
        <>
          {saved && (
            <p className="mb-3 text-sm text-muted-foreground" role="status">
              {t.saved}
            </p>
          )}
          {error !== null && !editorVisible && (
            <p role="alert" className="mb-3 text-sm text-destructive">
              {commandMessage(t, error)}
            </p>
          )}
          <div className="grid min-w-0 items-start gap-3 xl:grid-cols-[minmax(15rem,21rem)_minmax(0,1fr)]">
            <ProductionList
              {...{ workspace, busy, t }}
              scope={initialScope}
              selectSite={(siteId) => {
                if (siteId !== initialScope.siteId)
                  transition(() => router.push(productionHref({ siteId })));
              }}
            />
            {workspace.detail === null ? (
              <p className="rounded-lg border bg-card p-3 text-sm text-muted-foreground">
                {t.selectBuild}
              </p>
            ) : (
              <ProductionBuildView build={workspace.detail} {...{ busy, open, t }} />
            )}
          </div>
          {editorVisible && (
            <ProductionEditors
              {...{ editor, workspace, dialog, t }}
              initialSiteId={initialScope.siteId}
              initialReleaseId={initialScope.releaseId}
            />
          )}
        </>
      )}
    </div>
  );
}
