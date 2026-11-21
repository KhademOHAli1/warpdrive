"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { PageHeading } from "@/components/shell/PageHeading";
import { Button } from "@/components/ui/Button";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { trpc } from "@/lib/trpc-client";
import { readCsrfToken } from "@/utils/csrfCookie";
import type {
  PurchasingError,
  PurchasingIntent,
  PurchasingQuery,
  PurchasingResult,
  PurchasingWorkspace,
} from "../contracts";
import { executePurchasingAction } from "./actions";
import { purchaseMessages } from "./messages";
import { PurchaseEditors } from "./PurchaseEditors";
import { PurchasingView } from "./PurchasingView";
import {
  type OpenPurchaseEditor,
  type PurchaseDialogProps,
  type PurchaseEditor,
  purchaseOrderHref,
} from "./types";

function canOpenEditor(workspace: PurchasingWorkspace, editor: PurchaseEditor) {
  const site = workspace.sites.find(({ id }) => id === workspace.selectedSiteId);
  if (site === undefined || site.archived) return false;
  if (editor.order === null) return site.canBuy;
  const order = workspace.orders.find(({ id }) => id === editor.order?.id);
  if (order === undefined) return false;
  if (editor.type === "receive") return order.canReceive;
  if (editor.type === "draft")
    return order.canEdit && !order.lines.some(({ subcontracted }) => subcontracted === true);
  if (editor.type === "cancel")
    return order.canEdit && order.subcontractCancellationBlocked !== true;
  return order.canEdit;
}

export function PurchasingLive({
  actorId,
  initialQuery,
  initialResult,
}: {
  actorId: string;
  initialQuery: PurchasingQuery;
  initialResult: PurchasingResult;
}) {
  const t = purchaseMessages[useLocale()];
  const router = useRouter();
  const [navigating, transition] = useTransition();
  const [editor, setEditor] = useState<PurchaseEditor | null>(null);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<PurchasingError | "transport" | null>(null);
  const active = useRef(false);
  const attempted = useRef<{ intent: string; requestId: string } | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const actions = useRef<HTMLDivElement | null>(null);
  const utils = trpc.useUtils();
  const query = trpc.inventory.purchasing.workspace.useQuery(initialQuery, {
    initialData: initialResult,
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: "always",
  });
  const workspace = !query.isError && query.data.ok ? query.data.value : null;
  const busy = pending || navigating || query.isFetching;
  const siteId = workspace?.selectedSiteId ?? null;
  const editorVisible = workspace !== null && editor !== null && canOpenEditor(workspace, editor);

  const open: OpenPurchaseEditor = (event, next) => {
    trigger.current = event.currentTarget;
    setSaved(false);
    setError(null);
    setEditor(next);
  };

  async function save(intent: PurchasingIntent) {
    if (active.current) return;
    active.current = true;
    setPending(true);
    setError(null);
    const serialized = JSON.stringify(intent);
    const requestId =
      attempted.current?.intent === serialized ? attempted.current.requestId : crypto.randomUUID();
    attempted.current = { intent: serialized, requestId };
    try {
      const result = await executePurchasingAction(
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
      void utils.inventory.purchasing.workspace.invalidate();
      void utils.inventory.warehouse.workspace.invalidate();
      void utils.inventory.production.workspace.invalidate();
      if (intent.type === "saveDraft" && intent.id === null) {
        transition(() => router.push(purchaseOrderHref(intent.siteId, result.id)));
      }
    } catch {
      setError("transport");
    } finally {
      active.current = false;
      setPending(false);
    }
  }

  const dialog: PurchaseDialogProps = {
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
      className={`${BLOCK_CLASS} ph-no-capture min-w-0 pb-4`}
      aria-busy={busy}
      data-purchase-orders-workspace
    >
      <PageHeading
        title={t.title}
        crumbs={[{ label: t.inventory, href: "/inventory" }, { label: t.title }]}
        actions={
          <div ref={actions} tabIndex={-1}>
            <Button
              type="button"
              variant="outline"
              size="sm"
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
          {query.data.ok === false ? t[query.data.error] : t.unavailable}
        </p>
      ) : (
        <>
          {saved && (
            <p className="mb-3 text-sm text-muted-foreground" role="status">
              {t.saved}
            </p>
          )}
          {error !== null && !editorVisible && (
            <p role="alert" className="mb-3 text-sm text-destructive">
              {t[error]}
            </p>
          )}
          <PurchasingView
            {...{ workspace, busy, open, t }}
            selectSite={(next) => {
              if (next !== siteId) transition(() => router.push(purchaseOrderHref(next)));
            }}
          />
          {editor !== null && siteId !== null && editorVisible && (
            <PurchaseEditors {...{ editor, workspace, siteId, dialog, t }} />
          )}
        </>
      )}
    </main>
  );
}
