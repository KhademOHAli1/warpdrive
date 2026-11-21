"use client";

import { RefreshCw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { PageHeading } from "@/components/shell/PageHeading";
import { Button } from "@/components/ui/Button";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { trpc } from "@/lib/trpc-client";
import { useHydrated } from "@/lib/useHydrated";
import { readCsrfToken } from "@/utils/csrfCookie";
import type { SalesError, SalesQuery, SalesWorkspace, SalesWorkspaceResult } from "../contracts";
import { executeSalesAction } from "../webActions";
import { DraftEditor } from "./DraftEditor";
import { FulfillmentEditor } from "./FulfillmentEditor";
import { salesMessages } from "./messages";
import { SalesBrowse } from "./SalesBrowse";
import { SalesDetail } from "./SalesDetail";
import {
  type OpenSalesEditor,
  type SalesDialog,
  type SalesEditor,
  type SalesIntent,
  type SalesView,
  salesOrderHref,
} from "./types";

type SaveError = SalesError | "transport" | "checkMismatch";

function editorAllowed(workspace: SalesWorkspace, editor: SalesEditor) {
  if (editor.type === "saveDraft" && editor.order === null) {
    return (
      workspace.deal?.canOrder === true && workspace.sites.some(({ archived }) => archived !== true)
    );
  }
  const order = workspace.detail;
  if (order === null || order.id !== editor.order?.id) return false;
  switch (editor.type) {
    case "saveDraft":
    case "issueOrder":
      return order.status === "draft" && order.canEdit;
    case "reschedule":
      return order.status === "issued" && order.canEdit;
    case "cancelOrder":
      return (
        (order.status === "issued" || order.status === "draft") &&
        (order.canCancel ?? order.canEdit)
      );
    case "cancelShipment":
    case "checkShipmentLine":
    case "postShipment":
      return (
        order.canFulfill &&
        order.shipments.some(({ id, status }) => id === editor.shipment.id && status === "draft")
      );
    case "allocate":
    case "autoAllocate":
    case "createShipment":
    case "deallocate":
      return order.canFulfill;
  }
}

export function SalesLive({
  actorId,
  scope,
  initial,
  view,
  day,
}: {
  actorId: string;
  scope: SalesQuery;
  initial: SalesWorkspaceResult;
  view: SalesView;
  day: string | undefined;
}) {
  const t = salesMessages[useLocale()];
  const hydrated = useHydrated();
  const router = useRouter();
  const [navigating, transition] = useTransition();
  const [editor, setEditor] = useState<SalesEditor | null>(null);
  const [pending, setPending] = useState(false);
  const [saved, markSaved] = useState(false);
  const [error, setError] = useState<SaveError | null>(null);
  const active = useRef(false);
  const attempted = useRef<{ value: string; requestId: string } | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const actions = useRef<HTMLDivElement | null>(null);
  const utils = trpc.useUtils();
  const query = trpc.inventory.sales.workspace.useQuery(scope, {
    initialData: initial,
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: "always",
  });
  const workspace = !query.isError && query.data.ok ? query.data.value : null;
  const busy = !hydrated || pending || navigating || query.isFetching;
  const editorVisible = workspace !== null && editor !== null && editorAllowed(workspace, editor);

  function navigate(next: SalesQuery, layout: SalesView, anchor?: string) {
    transition(() => router.push(salesOrderHref(next, layout, anchor)));
  }

  const open: OpenSalesEditor = (event, next) => {
    if (busy) return;
    trigger.current = event.currentTarget;
    markSaved(false);
    setError(null);
    setEditor(next);
  };

  async function save(intent: SalesIntent) {
    if (!hydrated || active.current) return;
    active.current = true;
    setPending(true);
    setError(null);
    const value = JSON.stringify(intent);
    const requestId =
      attempted.current?.value === value ? attempted.current.requestId : crypto.randomUUID();
    attempted.current = { value, requestId };
    try {
      const result = await executeSalesAction(actorId, { ...intent, requestId }, readCsrfToken());
      attempted.current = null;
      if (!result.ok) {
        setError(
          result.error === "invalid" &&
            intent.type === "checkShipmentLine" &&
            intent.scan !== undefined
            ? "checkMismatch"
            : result.error,
        );
        if (result.error === "stale" || result.error === "unavailable" || result.error === "stock")
          void query.refetch();
        return;
      }
      setEditor(null);
      markSaved(true);
      await Promise.all([
        utils.inventory.sales.workspace.invalidate(),
        utils.inventory.workspace.invalidate(),
        utils.inventory.warehouse.workspace.invalidate(),
        utils.inventory.warehouse.history.invalidate(),
        utils.inventory.production.workspace.invalidate(),
        utils.inventory.bom.workspace.invalidate(),
      ]);
      if (
        intent.type === "saveDraft" &&
        (intent.orderId === null || (scope.siteId !== undefined && scope.siteId !== intent.siteId))
      ) {
        navigate(
          {
            ...scope,
            ...(scope.siteId === undefined ? {} : { siteId: intent.siteId }),
            orderId: result.id,
          },
          view,
          day,
        );
      }
    } catch {
      setError("transport");
    } finally {
      active.current = false;
      setPending(false);
    }
  }

  const dialog: SalesDialog = {
    pending,
    error: error === null ? null : t[error],
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
    <main
      className={`${BLOCK_CLASS} ph-no-capture min-w-0 space-y-3 pb-4`}
      data-sales-workspace
      aria-busy={busy}
    >
      <PageHeading
        title={t.title}
        crumbs={[{ label: t.inventory, href: "/inventory" }, { label: t.title }]}
        description={
          workspace?.deal === null || workspace?.deal === undefined ? undefined : (
            <Link
              href={`/deals/${encodeURIComponent(workspace.deal.id)}`}
              className="text-primary hover:underline"
              prefetch={false}
            >
              <bdi>{workspace.deal.name}</bdi>
            </Link>
          )
        }
        actions={
          <div ref={actions} tabIndex={-1}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void query.refetch()}
            >
              <RefreshCw aria-hidden="true" className="size-4" />
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
            <p role="status" className="text-sm text-muted-foreground">
              {t.saved}
            </p>
          )}
          {error !== null && !editorVisible && (
            <p role="alert" className="text-sm text-destructive">
              {t[error]}
            </p>
          )}
          <SalesBrowse {...{ workspace, scope, view, day, busy, open, navigate, t }} />
          {workspace.detail !== null && (
            <SalesDetail
              key={workspace.detail.id}
              order={workspace.detail}
              {...{ workspace, open, busy, t }}
            />
          )}
          {editorVisible &&
            (editor.type === "saveDraft" ? (
              <DraftEditor
                key={editor.order?.id ?? "new"}
                order={editor.order}
                selectedSiteId={scope.siteId}
                {...{ workspace, dialog, t }}
              />
            ) : (
              <FulfillmentEditor
                key={`${editor.order.id}:${editor.type}`}
                {...{ editor, workspace, dialog, t }}
              />
            ))}
        </>
      )}
    </main>
  );
}
