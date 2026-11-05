"use client";
import { ArrowLeft, LayoutGrid, Plus, Redo2, Undo2 } from "lucide-react";
import Link from "next/link";
import { type RefObject, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import type { WorkflowV2Document } from "@/features/blocks/contracts";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { WorkflowEditorSplit } from "@/features/workflows/ui/WorkflowEditorSplit";
import { WorkflowReferenceIcon } from "@/features/workflows/ui/WorkflowReferenceIcon";
import editorStyles from "@/features/workflows/ui/workflowEditor.module.css";
import inspectorStyles from "@/features/workflows/ui/workflowInspector.module.css";
import "@/features/workflows/ui/workflowTheme.css";
import { useFormatters } from "@/lib/useFormatters";
import { StudioActionPicker } from "./StudioActionPicker";
import { StudioConnections } from "./StudioConnections";
import { StudioLiveDialog } from "./StudioLiveDialog";
import { StudioOutput } from "./StudioOutput";
import { StudioTrigger } from "./StudioTrigger";
import { updateStudioNode } from "./studioModel";
import { studioActions, studioTriggers } from "./studioPresentation";
import { useStudioLeaveGuard } from "./useStudioLeaveGuard";
import { useWorkflowStudio, type WorkflowStudioModel } from "./useWorkflowStudio";
import { WorkflowRunPanel } from "./WorkflowRunPanel";
import { WorkflowStudioCanvas } from "./WorkflowStudioCanvas";
import { WorkflowStudioInspector } from "./WorkflowStudioInspector";

function StudioToolbar({
  model,
  returnTo,
  onLive,
  onArchive,
  onPalette,
  configureButton,
}: {
  model: WorkflowStudioModel;
  returnTo: string;
  onLive: () => void;
  onArchive: () => void;
  onPalette: () => void;
  configureButton: RefObject<HTMLButtonElement | null>;
}) {
  const { L } = model;
  const format = useFormatters();
  return (
    <header className="shrink-0">
      <div className={`${editorStyles.header} ${editorStyles.studioPrimary}`}>
        <Link
          href={returnTo.startsWith("/workflows") ? returnTo : "/workflows"}
          className={editorStyles.studioBack}
        >
          <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
          {L.back}
        </Link>
        <div className={editorStyles.name}>
          <Input
            aria-label={L.name}
            value={model.document.name}
            maxLength={120}
            disabled={model.disabled}
            onChange={(event) => model.name(event.target.value)}
          />
          <span className={editorStyles.metadata}>
            {model.archived ? L.archive : model.document.active ? L.active : L.draft} · {L.revision}{" "}
            {format.number(model.document.revision)}
            {model.dirty ? ` · ${L.unsaved}` : ""}
          </span>
        </div>
        <div className={editorStyles.actions}>
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
            disabled={model.pending || model.manualLaunch === null}
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
      <div className={`${editorStyles.viewbar} ${editorStyles.studioControls}`}>
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
        <div className="min-w-32 max-w-64">
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
            triggerClassName="text-xs"
          />
        </div>
        <Button
          ref={configureButton}
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

function StudioPanelHeader({
  model,
  title,
  onClose,
}: {
  model: WorkflowStudioModel;
  title: string;
  onClose: () => void;
}) {
  const { L, tab, selected, document } = model;
  const node =
    tab === "configure" ? document.draft.nodes.find((item) => item.id === selected) : undefined;
  const triggerType = document.draft.trigger.type;
  const trigger =
    tab === "configure" && selected === "$trigger" ? studioTriggers[triggerType] : undefined;
  const appearance = node === undefined ? undefined : studioActions[node.type];
  const icon = appearance?.icon ?? trigger?.icon;
  const category = appearance === undefined ? L.trigger : L.groups[appearance.group];
  return (
    <header className={`${inspectorStyles.header} sticky top-0 z-10`}>
      {icon !== undefined && (
        <span
          className={inspectorStyles.icon}
          data-studio-category={appearance?.group}
          data-node-type={
            trigger === undefined
              ? undefined
              : triggerType.startsWith("record.")
                ? "trigger.record"
                : "trigger.manual"
          }
        >
          <WorkflowReferenceIcon name={icon} stroke={appearance?.stroke} />
        </span>
      )}
      <div className={inspectorStyles.heading}>
        <h2 dir="auto" className={inspectorStyles.title}>
          {node?.name ?? (trigger === undefined ? title : (L.triggers[trigger.key] ?? title))}
        </h2>
        {icon !== undefined && <span className={inspectorStyles.category}>{category}</span>}
      </div>
      <Button
        type="button"
        variant="outline"
        size="icon"
        static
        className={inspectorStyles.close}
        aria-label={L.close}
        onClick={onClose}
      >
        <WorkflowReferenceIcon name="x" />
      </Button>
    </header>
  );
}

function StudioSidebar({
  model,
  palettePort,
  paletteEdge,
  onClose,
  onAdd,
}: {
  model: WorkflowStudioModel;
  palettePort?: string;
  paletteEdge?: string;
  onClose: () => void;
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
            {model.simulation.steps.map((step) => (
              <section key={step.visitKey} className="space-y-2 border-t pt-3">
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
      <StudioActionPicker model={model} port={palettePort} edgeId={paletteEdge} onClose={onClose} />
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
  const [live, setLive] = useState<WorkflowStudioModel["manualLaunch"]>(null);
  const [archive, setArchive] = useState(false);
  const [insertion, setInsertion] = useState<{ port: string; edgeId?: string }>();
  const configureButton = useRef<HTMLButtonElement>(null);
  const leave = useStudioLeaveGuard(model.dirty, model.pending);
  const [historyOpened, setHistoryOpened] = useState(false);
  if (initialHistory && !historyOpened) {
    setHistoryOpened(true);
    model.setTab("runs");
  }
  const panelTitle = {
    configure: model.L.configure,
    palette: model.L.add,
    runs: model.L.history,
    test: model.L.syntheticTest,
  }[model.tab ?? "configure"];
  function closePanel() {
    model.setTab(null);
    configureButton.current?.focus();
  }
  return (
    <div
      dir={locale === "fa" ? "rtl" : "ltr"}
      className={`workflow-twenty-theme ${editorStyles.editor}`}
      data-workflow-editor
    >
      <div className={editorStyles.body}>
        <StudioToolbar
          model={model}
          returnTo={returnTo}
          onLive={() => setLive(model.manualLaunch)}
          onArchive={() => setArchive(true)}
          configureButton={configureButton}
          onPalette={() => {
            setInsertion(undefined);
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
        <WorkflowEditorSplit
          open={model.tab !== null}
          panelLabel={panelTitle}
          onClose={closePanel}
          canvas={
            <WorkflowStudioCanvas
              definition={model.document.draft}
              selected={model.tab === null ? "" : model.selected}
              onSelect={(id) => {
                model.select(id);
                model.setTab("configure");
              }}
              onClearSelection={() => model.setTab(null)}
              onInsert={(source, port, edgeId) => {
                model.select(source);
                setInsertion({ port, edgeId });
                model.setTab("palette");
              }}
              pending={
                model.tab === "palette" && insertion?.edgeId === undefined
                  ? { source: model.selected, port: insertion?.port ?? "next" }
                  : undefined
              }
              onChange={model.edit}
              disabled={model.disabled}
              reveal={model.reveal}
              layoutRevision={model.layoutRevision}
            />
          }
        >
          {model.tab !== null && (
            <>
              {(model.tab !== "palette" || model.studio === null) && (
                <StudioPanelHeader model={model} title={panelTitle} onClose={closePanel} />
              )}
              <StudioSidebar
                model={model}
                palettePort={insertion?.port}
                paletteEdge={insertion?.edgeId}
                onClose={closePanel}
                onAdd={(port) => {
                  setInsertion({ port });
                  model.setTab("palette");
                }}
              />
            </>
          )}
        </WorkflowEditorSplit>
      </div>
      {live !== null && (
        <StudioLiveDialog launch={live} model={model} onClose={() => setLive(null)} />
      )}
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
