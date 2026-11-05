"use client";

import { LayoutGrid, Maximize2, Plus } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Tip } from "@/components/ui/tooltip";
import { useAppTranslations, useLocale } from "@/features/i18n/LocaleProvider";
import { useFormatters } from "@/lib/useFormatters";
import type { OutputTarget } from "../connectionGestures";
import { duplicateNode } from "../duplicateNode";
import {
  type ConnectionProblem,
  edgeId,
  removeNode,
  updateNodeConfiguration,
} from "../graphEditor";
import { arrangeGraph, type NodeMeasurements } from "../nodeLayout";
import { displayNodeName, nodeLabelKeys } from "../nodeNames";
import { orderedWorkflowNodes } from "../nodeOrder";
import { type PickerRequest, type PickerSelection, selectPaletteEntry } from "../paletteContext";
import type { DefinitionIssue, NodePosition, WorkflowDefinition } from "../schemas";
import { BuilderFrame } from "./BuilderFrame";
import { ConnectionEditor } from "./ConnectionEditor";
import { DefinitionIssues } from "./DefinitionIssues";
import { EdgeInspector } from "./EdgeInspector";
import { type GraphHistoryControls, HistoryControls, handleHistoryKey } from "./HistoryControls";
import { NodeInspector } from "./NodeInspector";
import type { PaletteRead } from "./paletteView";
import type { RevealNode } from "./ResponsiveViewport";
import { focusAvailable, useDialogFocus } from "./useDialogFocus";
import { WorkflowCanvas } from "./WorkflowCanvas";
import { WorkflowEditorSplit } from "./WorkflowEditorSplit";
import { WorkflowPalette } from "./WorkflowPalette";
import styles from "./workflowEditor.module.css";
import "./workflowTheme.css";

export function BuilderWorkspace({
  definition,
  workflowId,
  paletteRead,
  onChange,
  editable,
  issues,
  history,
}: {
  definition: WorkflowDefinition;
  workflowId?: string;
  paletteRead?: PaletteRead;
  onChange: Dispatch<SetStateAction<WorkflowDefinition>>;
  editable: boolean;
  issues: DefinitionIssue[];
  history?: GraphHistoryControls;
}) {
  const t = useAppTranslations("workflows");
  const workspace = useRef<HTMLElement>(null);
  const activeRequest = useRef<object | null>(null);
  const nodeMeasurements = useRef<NodeMeasurements>(new Map());
  const locale = useLocale();
  const fmt = useFormatters();
  const [expanded, setExpanded] = useState(false);
  const focusButton = useRef<HTMLButtonElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const stepName = useRef<HTMLInputElement>(null);
  const paletteFocus = useDialogFocus();
  const focusInsertedStep = useRef(false);
  const [selected, setSelected] = useState("");
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [palette, setPalette] = useState<{
    output?: OutputTarget;
    position?: NodePosition;
    replacementId?: string;
    token: object;
  } | null>(null);
  const [problem, setProblem] = useState<ConnectionProblem | null>(null);
  const [layoutRevision, setLayoutRevision] = useState(0);
  const [reveal, setReveal] = useState<RevealNode>({
    id: definition.nodes[0]?.id ?? "start",
    nonce: 0,
  });
  const node = definition.nodes.find((item) => item.id === selected);
  const edge = definition.edges.find((item) => edgeId(item) === selectedEdge);
  const invalidNodes = new Set(
    issues.flatMap((issue) => (issue.nodeId === undefined ? [] : [issue.nodeId])),
  );
  function select(id: string) {
    setSelected(id);
    setSelectedEdge(null);
    if (id === "") focusAvailable(workspace.current);
  }
  function closeInspector() {
    select("");
  }
  function revealStep(id: string) {
    select(id);
    setReveal((previous) => ({ id, nonce: previous.nonce + 1 }));
  }
  function openPalette(
    request: { output?: OutputTarget; position?: NodePosition; replacementId?: string },
    opener = document.activeElement,
  ) {
    paletteFocus.remember(
      opener instanceof HTMLElement && opener !== document.body ? opener : workspace.current,
    );
    focusInsertedStep.current = false;
    const token = {};
    activeRequest.current = token;
    setProblem(null);
    setPalette({ ...request, token });
  }
  function closePalette() {
    activeRequest.current = null;
    setPalette(null);
    setSelected("");
    setSelectedEdge(null);
  }
  function selectCanvasNode(id: string) {
    if (palette !== null) {
      activeRequest.current = null;
      focusInsertedStep.current = id !== "";
      setPalette(null);
    }
    select(id);
  }
  function selectCanvasEdge(id: string | null) {
    if (id !== null && palette !== null) {
      activeRequest.current = null;
      setPalette(null);
    }
    setSelectedEdge(id);
  }
  function clearCanvasSelection() {
    if (palette !== null) closePalette();
    else if (selected !== "" || selectedEdge !== null) closeInspector();
  }
  function focusPalette() {
    const panel = workspace.current?.querySelector('[role="dialog"]');
    focusAvailable(
      panel?.querySelector<HTMLElement>(
        '[data-workflow-palette-choice]:not([aria-disabled="true"])',
      ) ??
        panel?.querySelector<HTMLElement>("button") ??
        null,
    );
  }
  function pickerRequest(): PickerRequest {
    if (palette?.replacementId !== undefined)
      return { kind: "replace", nodeId: palette.replacementId };
    if (palette?.output === undefined) return { kind: "detached", position: palette?.position };
    return { kind: "output", output: palette.output, position: palette.position };
  }
  function choose(selection: PickerSelection, read: PaletteRead) {
    if (palette === null || activeRequest.current !== palette.token) return;
    const expectedId = workflowId ?? read.workflowId;
    const confirmed =
      read.status === "ready" &&
      read.workflowId === expectedId &&
      read.data !== undefined &&
      read.data.workflowId === expectedId;
    const result = selectPaletteEntry(definition, pickerRequest(), selection, {
      editable: editable && read.data?.authoring.allowed === true,
      metadataConfirmed: confirmed,
      newNodeId: `node_${crypto.randomUUID().slice(0, 8)}`,
      selectedId: selected || undefined,
      measurements: nodeMeasurements.current,
      nameForType: (type) => t(nodeLabelKeys[type]),
      subject: t("subject"),
    });
    if (!result.ok) {
      if (
        result.reason !== "not-editable" &&
        result.reason !== "metadata-unconfirmed" &&
        result.reason !== "unavailable-action"
      )
        setProblem(result.reason);
      return;
    }
    activeRequest.current = null;
    if (result.changed) onChange(result.definition);
    setProblem(null);
    focusInsertedStep.current = true;
    select(result.selectedId);
    setPalette(null);
  }
  return (
    <BuilderFrame expanded={expanded} onExpandedChange={setExpanded} returnFocus={focusButton}>
      <section
        ref={workspace}
        tabIndex={-1}
        aria-label={t("canvasTools")}
        onKeyDown={(event) => handleHistoryKey(event, history, editable)}
        className={`workflow-twenty-theme ${styles.workspace}`}
      >
        <div className={styles.tools}>
          <p className="max-w-xl text-xs leading-5 text-muted-foreground">{t("connectHint")}</p>
          <div className="flex flex-wrap gap-2">
            {history !== undefined && <HistoryControls history={history} editable={editable} />}
            {!expanded && (
              <Tip label={t("focusCanvas")}>
                <Button
                  ref={focusButton}
                  variant="ghost"
                  size="sm"
                  aria-label={t("focusCanvas")}
                  onClick={() => setExpanded(true)}
                >
                  <Maximize2 className="size-4" />
                  <span className="hidden sm:inline">{t("focusCanvas")}</span>
                </Button>
              </Tip>
            )}
            <Button
              ref={addButton}
              variant="outline"
              size="sm"
              disabled={!editable || definition.nodes.length >= 100}
              onClick={(event) => openPalette({}, event.currentTarget)}
            >
              <Plus className="size-4" />
              {t("addNode")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label={t("arrange")}
              title={t("arrange")}
              disabled={!editable}
              onClick={() => {
                onChange(arrangeGraph(definition));
                setLayoutRevision((value) => value + 1);
              }}
            >
              <LayoutGrid className="size-4" />
              <span className="hidden sm:inline">{t("arrange")}</span>
            </Button>
          </div>
        </div>
        {problem !== null && (
          <p role="alert" className="border-b bg-destructive/5 px-5 py-3 text-sm text-destructive">
            {t(`connectionErrors.${problem}`)}
          </p>
        )}
        <WorkflowEditorSplit
          panelLabel={t("configure")}
          open={palette !== null || node !== undefined || edge !== undefined}
          onClose={palette === null ? closeInspector : closePalette}
          canvas={
            <>
              {palette === null &&
                node === undefined &&
                edge === undefined &&
                issues.length > 0 && (
                  <div className={styles.canvasIssues}>
                    <DefinitionIssues
                      definition={definition}
                      issues={issues}
                      onSelect={revealStep}
                    />
                  </div>
                )}
              <nav aria-label={t("steps")} className={styles.stepNavigation}>
                {orderedWorkflowNodes(definition).map((item, index) => (
                  <Button
                    key={item.id}
                    variant={selected === item.id && selectedEdge === null ? "outline" : "ghost"}
                    size="sm"
                    aria-pressed={selected === item.id && selectedEdge === null}
                    onClick={() => revealStep(item.id)}
                    title={displayNodeName(item, locale)}
                  >
                    <bdi className="text-muted-foreground">{fmt.number(index + 1)}</bdi>
                    <bdi className="block max-w-36 truncate">{displayNodeName(item, locale)}</bdi>
                  </Button>
                ))}
              </nav>
              <WorkflowCanvas
                definition={definition}
                selected={selected}
                selectedEdge={selectedEdge}
                onSelect={selectCanvasNode}
                onSelectEdge={selectCanvasEdge}
                onClearSelection={clearCanvasSelection}
                onChange={onChange}
                onNodeMeasurements={(value) => {
                  nodeMeasurements.current = value;
                }}
                onProblem={setProblem}
                onChangeType={(nodeId) => {
                  select(nodeId);
                  openPalette({ replacementId: nodeId });
                }}
                onDuplicate={(nodeId) => {
                  if (!editable) return;
                  const newId = `node_${crypto.randomUUID().slice(0, 8)}`;
                  const result = duplicateNode(definition, nodeId, newId);
                  if (!result.ok) {
                    if (result.error === "nodeLimit") setProblem("nodeLimit");
                    return;
                  }
                  onChange(result.value);
                  setProblem(null);
                  select(newId);
                }}
                pendingInsert={
                  palette !== null && palette.replacementId === undefined
                    ? {
                        output: palette.output,
                        position: palette.position,
                        focusPicker: focusPalette,
                      }
                    : undefined
                }
                editable={editable}
                invalidNodes={invalidNodes}
                layoutRevision={layoutRevision}
                reveal={reveal}
                onAdd={(output, position) => {
                  select(output.from);
                  openPalette({ output, position });
                }}
              />
            </>
          }
        >
          {(palette !== null || node !== undefined || edge !== undefined) && (
            <>
              {palette !== null ? (
                <WorkflowPalette
                  workflowId={workflowId}
                  read={paletteRead}
                  definition={definition}
                  request={pickerRequest()}
                  editable={editable}
                  onClose={closePalette}
                  onChoose={choose}
                  onCloseAutoFocus={(event) => {
                    if (focusInsertedStep.current) {
                      event.preventDefault();
                      focusAvailable(stepName.current);
                    } else paletteFocus.restore(event, workspace.current);
                  }}
                />
              ) : null}
              <div hidden={palette !== null}>
                <DefinitionIssues definition={definition} issues={issues} onSelect={revealStep} />
                {edge !== undefined ? (
                  <EdgeInspector
                    definition={definition}
                    edge={edge}
                    editable={editable}
                    onChange={onChange}
                    onProblem={setProblem}
                    onClose={closeInspector}
                  />
                ) : node !== undefined ? (
                  <>
                    <NodeInspector
                      workflowId={workflowId}
                      definition={definition}
                      node={node}
                      editable={editable}
                      nameInputRef={stepName}
                      onClose={closeInspector}
                      onChange={(changed) =>
                        onChange((graph) => updateNodeConfiguration(graph, changed))
                      }
                      onRemove={() => {
                        if (!editable || node.type.startsWith("trigger.")) return;
                        onChange((graph) => removeNode(graph, node.id));
                        closeInspector();
                      }}
                    />
                    <ConnectionEditor
                      definition={definition}
                      node={node}
                      editable={editable}
                      onChange={onChange}
                      onProblem={setProblem}
                      onAdd={(output) => openPalette({ output })}
                    />
                  </>
                ) : (
                  <p className="p-5 text-sm text-muted-foreground">{t("configureHint")}</p>
                )}
              </div>
            </>
          )}
        </WorkflowEditorSplit>
      </section>
    </BuilderFrame>
  );
}
