"use client";

import { ArrowRightLeft, Merge, Plus, RefreshCw, Split } from "lucide-react";
import { type MouseEvent, useRef, useState } from "react";
import { PageHeading } from "@/components/shell/PageHeading";
import { Button } from "@/components/ui/Button";
import { PILL_TAB, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { trpc } from "@/lib/trpc-client";
import { readCsrfToken } from "@/utils/csrfCookie";
import type { WarehousePosition, WarehouseResult, WarehouseWorkspace } from "../../contracts";
import { receivableLocations } from "../../ui/warehouseDisplay";
import { warehouseMessages } from "../../ui/warehouseMessages";
import type { WarehouseOperationsError, WarehouseOperationsIntent } from "../contracts";
import { executeWarehouseOperations } from "./actions";
import {
  NewTransferDialog,
  type OperationsDialogProps,
  type OperationsEditor,
  StockCorrectionDialog,
  TransferProgressDialog,
} from "./OperationsDialogs";
import { HistoryView, TransfersView } from "./OperationsViews";
import { operationsMessages } from "./operationsMessages";
import { StockStructurePositionDialog, StockStructureRecoveryDialog } from "./StructureDialogs";
import { StockStructureView } from "./StructureView";
import { mergeSources, splitLimit } from "./structureDisplay";

const sections = ["history", "transfers", "corrections", "structure"] as const;

function OperationEditor({
  editor,
  workspace,
  dialog,
  managed,
  positions,
}: {
  editor: OperationsEditor;
  workspace: WarehouseWorkspace;
  dialog: OperationsDialogProps;
  managed: ReturnType<typeof receivableLocations>;
  positions: WarehousePosition[];
}) {
  switch (editor.type) {
    case "createTransfer":
      return <NewTransferDialog {...dialog} workspace={workspace} locations={managed} />;
    case "correctStock":
      return <StockCorrectionDialog {...dialog} workspace={workspace} positions={positions} />;
    case "reverseCorrection":
      return (
        <StockCorrectionDialog
          {...dialog}
          workspace={workspace}
          positions={positions}
          reverse={editor}
        />
      );
    case "dispatchTransfer":
    case "receiveTransfer":
    case "cancelTransfer":
      return <TransferProgressDialog {...dialog} mode={editor.type} transfer={editor.transfer} />;
    case "splitStock":
    case "mergeStock":
    case "installComponent":
      return (
        <StockStructurePositionDialog
          {...dialog}
          editor={editor}
          workspace={workspace}
          positions={positions}
        />
      );
    case "removeComponent":
    case "disassembleStock":
      return (
        <StockStructureRecoveryDialog
          {...dialog}
          editor={editor}
          workspace={workspace}
          locations={managed}
        />
      );
  }
}

export function WarehouseOperationsLive({
  actorId,
  initial,
  initialMovementId,
}: {
  actorId: string;
  initial: WarehouseResult;
  initialMovementId?: string;
}) {
  const locale = useLocale();
  const t = operationsMessages[locale];
  const [tab, setTab] = useState<(typeof sections)[number]>("history");
  const [editor, setEditor] = useState<OperationsEditor | null>(null);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<WarehouseOperationsError | "transport" | null>(null);
  const active = useRef(false);
  const attempted = useRef<{ intent: string; requestId: string } | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const actions = useRef<HTMLDivElement | null>(null);
  const utils = trpc.useUtils();
  const stock = trpc.inventory.warehouse.workspace.useQuery(
    { showEmpty: true },
    { initialData: initial, retry: false, gcTime: 0, refetchOnWindowFocus: false },
  );
  const workspace = !stock.isError && stock.data.ok ? stock.data.value : null;
  const managed = workspace === null ? [] : receivableLocations(workspace);
  const managedIds = new Set(managed.map(({ id }) => id));
  const positions =
    workspace?.positions.filter(({ locationId }) => managedIds.has(locationId)) ?? [];
  const canTransfer = managed.length > 1 && positions.some((row) => row.onHand > row.reserved);
  const canCorrect = positions.length > 0;

  async function refresh() {
    await Promise.all([
      utils.inventory.warehouse.workspace.invalidate({ showEmpty: true }),
      utils.inventory.warehouse.history.invalidate(),
      utils.inventory.warehouse.transfers.invalidate(),
      utils.inventory.warehouse.installations.invalidate(),
    ]);
  }

  function open(event: MouseEvent<HTMLButtonElement>, next: OperationsEditor) {
    trigger.current = event.currentTarget;
    setError(null);
    setSaved(false);
    setEditor(next);
  }

  async function save(intent: WarehouseOperationsIntent) {
    if (active.current) return;
    active.current = true;
    setPending(true);
    setError(null);
    const key = JSON.stringify(intent);
    const requestId =
      attempted.current?.intent === key ? attempted.current.requestId : crypto.randomUUID();
    attempted.current = { intent: key, requestId };
    try {
      const result = await executeWarehouseOperations(
        actorId,
        { ...intent, requestId },
        readCsrfToken(),
      );
      attempted.current = null;
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEditor(null);
      setSaved(true);
      void refresh();
    } catch {
      setError("transport");
    } finally {
      active.current = false;
      setPending(false);
    }
  }

  const dialog: OperationsDialogProps = {
    pending,
    error: error === null ? null : t[error],
    close: () => setEditor(null),
    restoreFocus: () => {
      if (trigger.current?.isConnected === true) trigger.current.focus();
      else actions.current?.focus();
    },
    save,
  };

  const busy = pending || stock.isFetching;
  return (
    <main className={`${BLOCK_CLASS} ph-no-capture min-w-0 pb-4`} aria-busy={busy}>
      <PageHeading
        title={t.title}
        crumbs={[
          { label: warehouseMessages[locale].inventory, href: "/inventory" },
          { label: t.warehouse, href: "/inventory/warehouse" },
          { label: t.title },
        ]}
        actions={
          <div ref={actions} tabIndex={-1} className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => {
                void refresh();
              }}
            >
              <RefreshCw aria-hidden="true" />
              {t.refresh}
            </Button>
            {tab === "transfers" && canTransfer && (
              <Button
                size="sm"
                disabled={busy}
                onClick={(event) => open(event, { type: "createTransfer" })}
              >
                <ArrowRightLeft aria-hidden="true" />
                {t.newTransfer}
              </Button>
            )}
            {tab === "corrections" && canCorrect && (
              <Button
                size="sm"
                disabled={busy}
                onClick={(event) => open(event, { type: "correctStock" })}
              >
                <Plus aria-hidden="true" />
                {t.correctStock}
              </Button>
            )}
            {tab === "structure" && (
              <>
                {positions.some((position) => splitLimit(position) > 0) && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={(event) => open(event, { type: "splitStock" })}
                  >
                    <Split aria-hidden="true" />
                    {t.splitStock}
                  </Button>
                )}
                {mergeSources(positions).length > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={(event) => open(event, { type: "mergeStock" })}
                  >
                    <Merge aria-hidden="true" />
                    {t.mergeStock}
                  </Button>
                )}
              </>
            )}
          </div>
        }
      />
      {workspace === null ? (
        <p role="alert" className="rounded-lg border bg-card p-4 text-sm text-destructive">
          {t.unavailable}
        </p>
      ) : (
        <>
          {saved && (
            <p role="status" className="mb-3 text-sm text-muted-foreground">
              {t.saved}
            </p>
          )}
          <Tabs
            value={tab}
            onValueChange={(value) => {
              const next = sections.find((section) => section === value);
              if (next !== undefined) setTab(next);
            }}
          >
            <TabsList
              aria-label={t.title}
              className="inline-flex w-fit max-w-full flex-wrap gap-1 rounded-lg border bg-card p-0.5"
            >
              {sections.map((section) => (
                <TabsTrigger key={section} className={PILL_TAB} value={section}>
                  {t[section]}
                </TabsTrigger>
              ))}
            </TabsList>
            <TabsContent value="history">
              <HistoryView
                workspace={workspace}
                open={open}
                busy={busy}
                initialMovementId={initialMovementId}
              />
            </TabsContent>
            <TabsContent value="transfers">
              <TransfersView workspace={workspace} open={open} busy={busy} />
            </TabsContent>
            <TabsContent value="corrections">
              <HistoryView workspace={workspace} open={open} busy={busy} corrections />
            </TabsContent>
            <TabsContent value="structure">
              <StockStructureView
                workspace={workspace}
                managedPositions={positions}
                open={open}
                busy={busy}
              />
            </TabsContent>
          </Tabs>
          {editor !== null && (
            <OperationEditor
              editor={editor}
              workspace={workspace}
              dialog={dialog}
              managed={managed}
              positions={positions}
            />
          )}
        </>
      )}
    </main>
  );
}
