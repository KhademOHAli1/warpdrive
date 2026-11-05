"use client";
import { ArrowLeft, LayoutGrid, Plus, Redo2, Undo2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { ACTION_BLOCK_KINDS, type WorkflowV2Document } from "@/features/blocks/contracts";
import { BlockPalette } from "@/features/blocks/ui/BlockPalette";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { useFormatters } from "@/lib/useFormatters";
import { StudioConnections } from "./StudioConnections";
import { StudioLiveDialog } from "./StudioLiveDialog";
import { StudioOutput } from "./StudioOutput";
import { StudioTrigger } from "./StudioTrigger";
import { useStudioLeaveGuard } from "./useStudioLeaveGuard";
import { useWorkflowStudio, type WorkflowStudioModel } from "./useWorkflowStudio";
import { WorkflowRunPanel } from "./WorkflowRunPanel";
import { studioCategory, studioIcons, WorkflowStudioCanvas } from "./WorkflowStudioCanvas";
import { WorkflowStudioInspector } from "./WorkflowStudioInspector";
import { studioSetupHref, updateStudioNode } from "./studioModel";

function StudioToolbar({
  model,
  onLive,
  onArchive,
  onPalette,
}: {
  model: WorkflowStudioModel;
  onLive: () => void;
  onArchive: () => void;
  onPalette: () => void;
}) {
  const { L } = model;
  const format = useFormatters();
  return (
    <header className="shrink-0 border-b bg-background px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label={L.name}
          value={model.document.name}
          maxLength={120}
          disabled={model.disabled}
          onChange={(event) => model.name(event.target.value)}
          className="h-8 min-w-40 max-w-80 flex-1 border-transparent px-2 text-sm font-medium shadow-none hover:border-border"
        />
        <span className="text-[10px] text-muted-foreground">
          {model.archived ? L.archive : model.document.active ? L.active : L.draft} · {L.revision}{" "}
          {format.number(model.document.revision)}
          {model.dirty ? ` · ${L.unsaved}` : ""}
        </span>
        <div className="ms-auto flex flex-wrap gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            disabled={model.disabled || model.past.length === 0}
            aria-label={L.undo}
            onClick={() => model.undo("undo")}
          >
            <Undo2 className="size-3.5" aria-hidden />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={model.disabled || model.future.length === 0}
            aria-label={L.redo}
            onClick={() => model.undo("redo")}
          >
            <Redo2 className="size-3.5" aria-hidden />
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={model.pending || model.archived || !model.capabilities.run}
            onClick={() => void model.test()}
          >
            {L.test}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={model.disabled || !model.dirty}
            onClick={() => void model.command("save")}
          >
            {L.save}
          </Button>
          <Button
            size="sm"
            disabled={
              model.pending ||
              model.archived ||
              !model.capabilities.publish ||
              model.document.draft.nodes.length === 0
            }
            onClick={() => void model.command("publish")}
          >
            {L.publish}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={
              model.pending ||
              model.archived ||
              !model.capabilities.run ||
              model.dirty ||
              !model.document.active ||
              model.document.draft.trigger.type !== "manual"
            }
            onClick={onLive}
          >
            {L.run}
          </Button>
          {model.document.active && (
            <Button
              size="sm"
              variant="ghost"
              disabled={model.disabled}
              onClick={() => void model.command("pause")}
            >
              {L.pause}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            disabled={model.pending || !model.capabilities.archive}
            onClick={() => (model.archived ? void model.command("restore") : onArchive())}
          >
            {model.archived ? L.restore : L.archive}
          </Button>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
        <Button
          size="sm"
          variant={model.tab === "palette" ? "outline" : "ghost"}
          disabled={model.disabled || model.document.draft.nodes.length >= 100}
          onClick={onPalette}
        >
          <Plus className="size-3.5" aria-hidden />
          {L.add}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-label={L.arrange}
          disabled={model.disabled}
          onClick={model.arrange}
        >
          <LayoutGrid className="size-3.5" aria-hidden />
        </Button>
        <div className="min-w-40 max-w-64">
          <Select
            ariaLabel={L.selectStep}
            value={model.selected}
            options={[
              { value: "$trigger", label: L.trigger },
              ...model.document.draft.nodes.map((node, index) => ({
                value: node.id,
                label: `${format.number(index + 1)} · ${node.name}`,
              })),
            ]}
            onChange={(id) => {
              model.select(id, true);
              model.setTab("configure");
            }}
            triggerClassName="h-8 text-xs"
          />
        </div>
        <Button
          size="sm"
          variant={model.tab === "configure" ? "outline" : "ghost"}
          onClick={() => model.setTab("configure")}
        >
          {L.configure}
        </Button>
        <Button
          size="sm"
          variant={model.tab === "runs" ? "outline" : "ghost"}
          onClick={() => model.setTab("runs")}
        >
          {L.history}
        </Button>
      </div>
    </header>
  );
}
function StudioSidebar({
  model,
  palettePort,
  onAdd,
}: {
  model: WorkflowStudioModel;
  palettePort?: string;
  onAdd: (port: string) => void;
}) {
  const { L, studio } = model;
  const node = model.document.draft.nodes.find((item) => item.id === model.selected);
  if (model.tab === "runs")
    return (
      <WorkflowRunPanel
        key={model.runId ?? model.document.id}
        workflowId={model.document.id}
        initialRunId={model.runId}
      />
    );
  if (model.tab === "test")
    return (
      <div className="space-y-4 p-4">
        <h2 className="text-sm font-medium">{L.syntheticTest}</h2>
        <p className="text-xs leading-relaxed text-muted-foreground">{L.syntheticHint}</p>
        {model.pending && (
          <p role="status" className="text-xs text-muted-foreground">
            {L.working}
          </p>
        )}
        {model.simulation !== null && (
          <div className="space-y-4">
            <p className="text-xs font-medium">
              {L.runStates[model.simulation.status] ?? L.testResult}
            </p>
            {model.simulation.steps.map((step, index) => (
              <section key={`${step.visitKey}:${index}`} className="space-y-2 border-t pt-3">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-auto px-0 text-start text-xs"
                  onClick={() => {
                    model.select(step.nodeId, true);
                    model.setTab("configure");
                  }}
                >
                  {model.document.draft.nodes.find((item) => item.id === step.nodeId)?.name ??
                    L.output}
                </Button>
                <p className="text-[10px] text-muted-foreground">
                  {L.testStates[step.state] ?? L.testResult}
                </p>
                {step.output !== null && <StudioOutput value={step.output} />}
                {step.errorId !== undefined && (
                  <p className="text-xs text-destructive">
                    {step.errorId.endsWith("TEST_DEPENDENCY") ? L.testDependency : L.failed}
                  </p>
                )}
              </section>
            ))}
          </div>
        )}
      </div>
    );
  if (studio === null)
    return (
      <div className="space-y-3 p-4">
        <p
          role={model.metadataError ? "alert" : "status"}
          className="text-xs text-muted-foreground"
        >
          {model.metadataError ? L.failed : L.working}
        </p>
        {model.metadataError && (
          <Button size="sm" variant="outline" onClick={() => void model.loadStudio()}>
            {L.retry}
          </Button>
        )}
      </div>
    );
  if (model.tab === "palette")
    return (
      <BlockPalette
        categories={L.groups}
        disabled={model.disabled}
        rows={ACTION_BLOCK_KINDS.map((type) => {
          const readiness = studio.readiness[type];
          const Icon = studioIcons[type];
          return {
            id: type,
            label: L.blocks[type] ?? type,
            category: studioCategory(type),
            icon: <Icon className="size-3.5 text-muted-foreground" aria-hidden />,
            state:
              readiness?.state === "forbidden"
                ? "denied"
                : readiness?.state === "unsupported_in_context"
                  ? "unavailable"
                  : readiness?.state === "needs_connection"
                    ? "needs-setup"
                    : "ready",
            ...(readiness?.state === "needs_connection"
              ? { setupHref: studioSetupHref(type) }
              : {}),
          };
        })}
        onChoose={(id) => {
          const type = ACTION_BLOCK_KINDS.find((kind) => kind === id);
          if (type !== undefined) model.add(type, palettePort);
        }}
      />
    );
  return (
    <>
      {model.selected === "$trigger" ? (
        <StudioTrigger
          document={model.document}
          studio={studio}
          disabled={model.disabled}
          dirty={model.dirty}
          onChange={(trigger) => model.edit({ ...model.document.draft, trigger })}
          onRotated={model.accept}
        />
      ) : node === undefined ? (
        <p className="p-4 text-xs text-muted-foreground">{L.empty}</p>
      ) : (
        <WorkflowStudioInspector
          definition={model.document.draft}
          node={node}
          studio={studio}
          disabled={model.disabled}
          onChange={(config) =>
            model.edit(updateStudioNode(model.document.draft, { ...node, config }))
          }
          onNodeChange={(changed) => model.edit(updateStudioNode(model.document.draft, changed))}
          onRemove={model.remove}
        />
      )}
      {(model.selected === "$trigger" || node !== undefined) && (
        <StudioConnections
          definition={model.document.draft}
          node={node}
          disabled={model.disabled}
          onChange={model.edit}
          onAdd={onAdd}
        />
      )}
    </>
  );
}
export function WorkflowStudio({
  initial,
  returnTo = "/workflows",
  initialHistory = false,
}: {
  initial: WorkflowV2Document;
  returnTo?: string;
  initialHistory?: boolean;
}) {
  const model = useWorkflowStudio(initial);
  const { locale } = useLocalePreferences();
  const [live, setLive] = useState(false);
  const [archive, setArchive] = useState(false);
  const [palettePort, setPalettePort] = useState<string>();
  const leave = useStudioLeaveGuard(model.dirty, model.pending);
  const [historyOpened, setHistoryOpened] = useState(false);
  if (initialHistory && !historyOpened) {
    setHistoryOpened(true);
    model.setTab("runs");
  }
  return (
    <div
      dir={locale === "fa" ? "rtl" : "ltr"}
      className="flex h-[calc(100dvh-100px)] min-h-[680px] flex-col gap-3"
    >
      <div className="flex shrink-0 items-center gap-2">
        <Link
          href={returnTo.startsWith("/workflows") ? returnTo : "/workflows"}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5 rtl:rotate-180" aria-hidden />
          {model.L.back}
        </Link>
        <span className="ms-auto text-[10px] text-muted-foreground">{model.L.title}</span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border bg-background">
        <StudioToolbar
          model={model}
          onLive={() => setLive(true)}
          onArchive={() => setArchive(true)}
          onPalette={() => {
            setPalettePort(undefined);
            model.setTab(model.tab === "palette" ? "configure" : "palette");
          }}
        />
        {model.error !== null && (
          <p
            role="alert"
            className="shrink-0 border-b bg-destructive/5 px-4 py-2 text-xs text-destructive"
          >
            {model.error}
          </p>
        )}
        {model.notice !== null && (
          <p role="status" className="shrink-0 border-b px-4 py-2 text-xs text-muted-foreground">
            {model.notice}
          </p>
        )}
        <div className="grid min-h-0 flex-1 grid-rows-[minmax(280px,1fr)_minmax(220px,44%)] lg:grid-cols-[minmax(0,1fr)_350px] lg:grid-rows-1">
          <WorkflowStudioCanvas
            definition={model.document.draft}
            selected={model.selected}
            onSelect={(id) => {
              model.select(id);
              model.setTab("configure");
            }}
            onChange={model.edit}
            disabled={model.disabled}
            reveal={model.reveal}
            layoutRevision={model.layoutRevision}
          />
          <aside className="min-h-0 overflow-y-auto border-t bg-background lg:border-s lg:border-t-0">
            <StudioSidebar
              model={model}
              palettePort={palettePort}
              onAdd={(port) => {
                setPalettePort(port);
                model.setTab("palette");
              }}
            />
          </aside>
        </div>
      </div>
      {live && <StudioLiveDialog model={model} onClose={() => setLive(false)} />}
      <ConfirmDialog
        open={archive}
        onOpenChange={setArchive}
        title={model.L.archiveTitle}
        description={model.L.archiveHint}
        confirmLabel={model.L.archive}
        cancelLabel={model.L.cancel}
        destructive
        pending={model.pending}
        onConfirm={() => {
          setArchive(false);
          void model.command("archive");
        }}
      />
      <ConfirmDialog
        open={leave.open}
        onOpenChange={(open) => {
          if (!open) leave.cancel();
        }}
        title={model.L.discardTitle}
        description={model.L.discardDescription}
        confirmLabel={model.L.discard}
        cancelLabel={model.L.keepEditing}
        destructive
        pending={model.pending}
        onConfirm={leave.leave}
      />
    </div>
  );
}
