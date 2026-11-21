"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { PageHeading } from "@/components/shell/PageHeading";
import { Button } from "@/components/ui/Button";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { trpc } from "@/lib/trpc-client";
import { useHydrated } from "@/lib/useHydrated";
import { readCsrfToken } from "@/utils/csrfCookie";
import type {
  ReturnError,
  ReturnsQuery,
  ReturnsWorkspace,
  ReturnsWorkspaceResult,
} from "../contracts";
import { executeReturnAction } from "../webActions";
import { returnMessages } from "./messages";
import { ReturnActions } from "./ReturnActions";
import { ReturnBrowse } from "./ReturnBrowse";
import { ReturnDetailView } from "./ReturnDetail";
import { ReturnDraft } from "./ReturnDraft";
import {
  canSetPhysicalDisposition,
  type OpenReturnEditor,
  type ReturnDialog,
  type ReturnEditor,
  type ReturnIntent,
  returnLifecycle,
  returnsHref,
} from "./types";

type SaveError = ReturnError | "transport";

function editorAllowed(workspace: ReturnsWorkspace, editor: ReturnEditor) {
  const source = workspace.source;
  if (editor.type === "saveDraft" && editor.detail === null) {
    return (
      source?.canCreate === true &&
      source.lines.some(({ eligible }) => eligible > 0) &&
      workspace.sites.some(({ archived }) => !archived)
    );
  }
  const detail = workspace.detail;
  if (detail === null || detail.id !== editor.detail?.id) return false;
  switch (editor.type) {
    case "saveDraft":
      return detail.status === "draft" && detail.canEdit && source?.id === detail.shipmentId;
    case "receive":
      return (
        detail.canReceive &&
        detail.status === "issued" &&
        detail.lines.some((line) => line.id === editor.line.id && line.received < line.quantity)
      );
    case "disposition":
      return (
        detail.canDispose &&
        detail.lines.some((line) =>
          line.receipts.some(
            (receipt) => receipt.id === editor.receipt.id && canSetPhysicalDisposition(receipt),
          ),
        )
      );
    case "commercial":
      return (
        detail.canCommercial &&
        detail.lines.some((line) =>
          line.receipts.some(
            (receipt) => receipt.id === editor.receipt.id && receipt.commercial === null,
          ),
        )
      );
    case "issue":
    case "hold":
    case "resume":
    case "duplicate":
    case "cancel":
    case "complete":
      return returnLifecycle(detail)[editor.type];
  }
}

function afterCommand(scope: ReturnsQuery, intent: ReturnIntent, id: string): ReturnsQuery | null {
  if (intent.type === "duplicate") return { ...scope, caseId: id };
  if (intent.type !== "saveDraft") return null;
  if (intent.caseId !== null && (scope.siteId === undefined || scope.siteId === intent.siteId))
    return null;
  return { ...scope, caseId: id, ...(scope.siteId === undefined ? {} : { siteId: intent.siteId }) };
}

export function ReturnsLive({
  actorId,
  scope,
  initial,
}: {
  actorId: string;
  scope: ReturnsQuery;
  initial: ReturnsWorkspaceResult;
}) {
  const t = returnMessages[useLocale()];
  const hydrated = useHydrated();
  const router = useRouter();
  const [navigating, transition] = useTransition();
  const [editor, setEditor] = useState<ReturnEditor | null>(null);
  const [pending, setPending] = useState(false);
  const [saved, markSaved] = useState(false);
  const [error, setError] = useState<SaveError | null>(null);
  const active = useRef(false);
  const attempted = useRef<{ value: string; requestId: string } | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const reloadButton = useRef<HTMLButtonElement>(null);
  const utils = trpc.useUtils();
  const query = trpc.inventory.returns.workspace.useQuery(scope, {
    initialData: initial,
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: "always",
  });
  const workspace = !query.isError && query.data.ok ? query.data.value : null;
  const busy = !hydrated || pending || navigating || query.isFetching;
  const editorVisible = workspace !== null && editor !== null && editorAllowed(workspace, editor);

  function navigate(next: ReturnsQuery) {
    transition(() => router.push(returnsHref(next)));
  }

  const open: OpenReturnEditor = (event, next) => {
    if (busy) return;
    trigger.current = event.currentTarget;
    markSaved(false);
    setError(null);
    setEditor(next);
  };

  async function save(intent: ReturnIntent) {
    if (!editorVisible || active.current) return;
    active.current = true;
    setPending(true);
    setError(null);
    const value = JSON.stringify(intent);
    const requestId =
      attempted.current?.value === value ? attempted.current.requestId : crypto.randomUUID();
    attempted.current = { value, requestId };
    try {
      const result = await executeReturnAction(actorId, { ...intent, requestId }, readCsrfToken());
      attempted.current = null;
      if (!result.ok) {
        setError(result.error);
        if (result.error === "stale" || result.error === "unavailable" || result.error === "stock")
          void query.refetch();
        return;
      }
      setEditor(null);
      markSaved(true);
      await Promise.all([
        utils.inventory.returns.workspace.invalidate(),
        utils.inventory.sales.workspace.invalidate(),
        utils.inventory.workspace.invalidate(),
        utils.inventory.warehouse.workspace.invalidate(),
        utils.inventory.warehouse.history.invalidate(),
        utils.inventory.production.workspace.invalidate(),
        utils.inventory.bom.workspace.invalidate(),
      ]);
      const next = afterCommand(scope, intent, result.id);
      if (next !== null) navigate(next);
    } catch {
      setError("transport");
    } finally {
      active.current = false;
      setPending(false);
    }
  }

  const dialog: ReturnDialog = {
    pending,
    error: error === null ? null : t[error],
    close: () => setEditor(null),
    restoreFocus: () => {
      if (trigger.current?.isConnected === true) trigger.current.focus();
      else reloadButton.current?.focus();
    },
    save: (intent) => {
      void save(intent);
    },
  };

  return (
    <main
      className={`${BLOCK_CLASS} ph-no-capture min-w-0 space-y-3 pb-4`}
      data-returns-workspace
      aria-busy={busy}
    >
      <PageHeading
        title={t.title}
        crumbs={[{ label: t.inventory, href: "/inventory" }, { label: t.title }]}
        actions={
          <Button
            ref={reloadButton}
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void query.refetch()}
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            {t.refresh}
          </Button>
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
          <ReturnBrowse {...{ workspace, scope, busy, open, navigate, t }} />
          {workspace.detail !== null && (
            <ReturnDetailView
              key={workspace.detail.id}
              detail={workspace.detail}
              {...{ workspace, busy, open, t }}
            />
          )}
          {editorVisible &&
            (editor.type === "saveDraft" ? (
              workspace.source !== null && (
                <ReturnDraft
                  key={editor.detail?.id ?? "new"}
                  detail={editor.detail}
                  source={workspace.source}
                  sites={workspace.sites}
                  preferredSiteId={scope.siteId}
                  {...{ dialog, t }}
                />
              )
            ) : (
              <ReturnActions
                key={`${editor.detail.id}:${editor.type}`}
                {...{ editor, workspace, dialog, t }}
              />
            ))}
        </>
      )}
    </main>
  );
}
