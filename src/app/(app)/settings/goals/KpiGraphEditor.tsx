"use client";

import { LayoutGrid, LoaderCircle, Play, Redo2, Save, Undo2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { CurrencySelect } from "@/features/currencies/CurrencySelect";
import { previewKpiAction, saveKpiDefinitionAction } from "@/features/goals/kpiActions";
import { useKpiGraphMessages } from "@/features/goals/kpiGraphMessages";
import { validateKpiGraphUnits } from "@/features/goals/kpiGraphUnits";
import { useKpiHubMessages } from "@/features/goals/kpiHubMessages";
import { useKpiMessages } from "@/features/goals/kpiMessages";
import {
  KPI_UNITS,
  type KpiDefinition,
  type KpiDefinitionInput,
  type KpiGraph,
  type KpiGraphHandle,
  type KpiGraphNode,
  type KpiMeasurement,
  type KpiUnit,
} from "@/features/goals/kpiModel";
import { kpiDefinitionInput } from "@/features/goals/kpiSchemas";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { useFormatters } from "@/lib/useFormatters";
import { instantCivilDate } from "@/lib/zonedDateTime";
import { readCsrfToken } from "@/utils/csrfCookie";
import { KpiGraphCanvas } from "./KpiGraphCanvas";
import { KpiGraphInspector } from "./KpiGraphInspector";
import {
  arrangeKpiGraph,
  changeGraphNode,
  connectGraphInput,
  disconnectGraphInput,
  type GraphNodeKind,
  type GraphPeriodChoice,
  graphFingerprint,
  graphFromDefinition,
  graphIssues,
  makeGraphNode,
  previewGraphPeriod,
  removeGraphNode,
  winRateGraph,
} from "./KpiGraphModel";
import { KpiGraphPalette } from "./KpiGraphPalette";
import { KpiPreview } from "./KpiPreview";
import type { Option } from "./types";

export interface KpiGraphEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialDefinition?: KpiDefinition;
  duplicate?: boolean;
  pipelines?: Option[];
  activityTypes?: Option[];
  baseCurrency?: string;
  canManage?: boolean;
  onSaved: () => void | Promise<void>;
}
interface History {
  past: KpiGraph[];
  present: KpiGraph;
  future: KpiGraph[];
}
type Issue = { nodeId?: string; edgeId?: string; code: string };

function issueMessage(code: string, L: ReturnType<typeof useKpiGraphMessages>): string {
  switch (code) {
    case "graph_missing_input":
      return L.variable;
    case "graph_unreachable":
      return L.disconnected;
    case "graph_cycle":
    case "graph_type_mismatch":
    case "graph_branch_type":
      return L.connectionError;
    case "graph_node_limit":
    case "graph_edge_limit":
      return L.limit;
    case "graph_output_count":
    case "graph_invalid_output":
      return L.outputHint;
    case "metric_configuration":
    case "constant_configuration":
      return L.invalidDefinition;
    case "graph_unit_mismatch":
    case "graph_output_unit":
    case "graph_mixed_currencies":
      return L.unitMismatch;
    default:
      return L.unknownIssue;
  }
}
function uniqueIssues(issues: Issue[]): Issue[] {
  return Array.from(
    new Map(
      issues.map((issue) => [`${issue.nodeId ?? ""}:${issue.edgeId ?? ""}:${issue.code}`, issue]),
    ).values(),
  );
}
function draftDefinition(
  name: string,
  description: string,
  unit: KpiUnit,
  currency: string,
  customUnit: string,
  graph: KpiGraph,
): KpiDefinitionInput {
  return {
    name,
    description,
    source: "deals",
    calculation: "count",
    dateField: "created",
    filters: {},
    unit,
    currency,
    customUnit,
    graph,
  };
}

function useGraphEditor({
  initialDefinition,
  duplicate = false,
  baseCurrency = "USD",
  canManage = true,
  onSaved,
  onOpenChange,
}: KpiGraphEditorProps) {
  const L = useKpiGraphMessages();
  const B = useKpiMessages();
  const H = useKpiHubMessages();
  const preferences = useLocalePreferences();
  const format = useFormatters();
  const [name, setName] = useState(
    initialDefinition === undefined
      ? ""
      : duplicate
        ? `${initialDefinition.name} · ${H.duplicate}`
        : initialDefinition.name,
  );
  const [description, setDescription] = useState(initialDefinition?.description ?? "");
  const [unit, setUnit] = useState<KpiUnit>(initialDefinition?.unit ?? "money");
  const [currency, setCurrency] = useState(initialDefinition?.currency ?? baseCurrency);
  const [customUnit, setCustomUnit] = useState(initialDefinition?.customUnit ?? "");
  const [history, setHistory] = useState<History>(() => ({
    past: [],
    present: graphFromDefinition(initialDefinition, baseCurrency, L.types),
    future: [],
  }));
  const [selected, setSelected] = useState<string | null>(
    () => history.present.nodes[0]?.id ?? null,
  );
  const [tab, setTab] = useState<"configure" | "preview">("configure");
  const [periodChoice, setPeriodChoice] = useState<GraphPeriodChoice>("monthly");
  const [pending, setPending] = useState<"preview" | "save" | null>(null);
  const [published, setPublished] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showIssues, setShowIssues] = useState(false);
  const [preview, setPreview] = useState<{
    fingerprint: string;
    period: GraphPeriodChoice;
    measurement: KpiMeasurement;
  } | null>(null);
  const [layoutRevision, setLayoutRevision] = useState(0);
  const [reveal, setReveal] = useState<{ id: string; nonce: number }>();
  const revealNonce = useRef(0);
  const lock = useRef(false);
  const request = useRef(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      request.current += 1;
    };
  }, []);
  const graph = history.present;
  const definition = draftDefinition(name, description, unit, currency, customUnit, graph);
  const fingerprint = graphFingerprint(definition);
  const [initialDraft] = useState(() => JSON.stringify(definition));
  const dirty = !published && JSON.stringify(definition) !== initialDraft;
  const currentPreview =
    preview?.fingerprint === fingerprint && preview.period === periodChoice
      ? preview.measurement
      : null;
  const disabled = pending !== null || !canManage || published;
  const unsupportedManual = initialDefinition?.source === "manual";
  const issues = uniqueIssues([
    ...graphIssues(graph),
    ...validateKpiGraphUnits(graph, { unit, currency, customUnit }),
  ]);
  const invalidNodes = new Set(
    issues.flatMap((issue) => (issue.nodeId === undefined ? [] : [issue.nodeId])),
  );
  const selectedNode = graph.nodes.find((node) => node.id === selected);
  const revision = initialDefinition !== undefined && !duplicate;
  function changed() {
    request.current += 1;
    setError(null);
    setShowIssues(false);
  }
  function editGraph(next: KpiGraph) {
    if (disabled || lock.current) return;
    changed();
    setHistory((current) =>
      JSON.stringify(current.present) === JSON.stringify(next)
        ? current
        : { past: [...current.past, current.present].slice(-30), present: next, future: [] },
    );
  }
  function editMetadata(patch: {
    name?: string;
    description?: string;
    unit?: KpiUnit;
    currency?: string;
    customUnit?: string;
  }) {
    if (disabled || lock.current) return;
    changed();
    if (patch.name !== undefined) setName(patch.name);
    if (patch.description !== undefined) setDescription(patch.description);
    if (patch.unit !== undefined) setUnit(patch.unit);
    if (patch.currency !== undefined) setCurrency(patch.currency);
    if (patch.customUnit !== undefined) setCustomUnit(patch.customUnit);
  }
  function select(id: string | null, revealNode = false) {
    setSelected(id);
    if (id !== null && revealNode) setReveal({ id, nonce: ++revealNonce.current });
    else setReveal(undefined);
  }
  function moveHistory(direction: "undo" | "redo") {
    if (disabled || lock.current) return;
    changed();
    setHistory((current) => {
      if (direction === "undo") {
        const previous = current.past.at(-1);
        return previous === undefined
          ? current
          : {
              past: current.past.slice(0, -1),
              present: previous,
              future: [current.present, ...current.future],
            };
      }
      const next = current.future[0];
      return next === undefined
        ? current
        : {
            past: [...current.past, current.present],
            present: next,
            future: current.future.slice(1),
          };
    });
  }
  function addNode(type: GraphNodeKind) {
    if (graph.nodes.length >= 40) {
      setError(L.limit);
      return;
    }
    const origin = selectedNode?.position ?? { x: 0, y: 0 };
    const node = makeGraphNode(
      type,
      L.types[type],
      { x: origin.x + 285, y: origin.y + 185 },
      currency,
    );
    let next: KpiGraph = {
      ...graph,
      nodes: [...graph.nodes, node],
      outputNodeId: type === "output" ? node.id : graph.outputNodeId,
    };
    if (selectedNode !== undefined) {
      const input =
        type === "output"
          ? "value"
          : type === "compute" || type === "compare" || type === "logic"
            ? "a"
            : null;
      if (input !== null) next = connectGraphInput(next, selectedNode.id, node.id, input) ?? next;
      const outgoing = graph.edges.filter((edge) => edge.source === selectedNode.id);
      if (input !== null && outgoing.length === 1 && outgoing[0]?.target === graph.outputNodeId)
        next = connectGraphInput(next, node.id, graph.outputNodeId, "value") ?? next;
    }
    editGraph(next);
    select(node.id, true);
    setTab("configure");
  }
  function changeNode(node: KpiGraphNode) {
    if (
      node.type === "metric" &&
      graph.nodes.length === 2 &&
      selectedNode?.type === "metric" &&
      unit === selectedNode.metric.unit
    )
      setUnit(node.metric.unit);
    editGraph(changeGraphNode(graph, node));
  }
  function deleteNode() {
    if (selected === null) return;
    editGraph(removeGraphNode(graph, selected));
    select(null);
  }
  function connect(source: string, target: string, handle: KpiGraphHandle, previousId?: string) {
    const candidate =
      previousId === undefined
        ? graph
        : { ...graph, edges: graph.edges.filter((edge) => edge.id !== previousId) };
    const next = connectGraphInput(candidate, source, target, handle);
    if (next === null) {
      setError(L.connectionError);
      return;
    }
    editGraph(next);
  }
  function input(handle: KpiGraphHandle, source: string) {
    if (selected === null) return;
    if (source === "") editGraph(disconnectGraphInput(graph, selected, handle));
    else connect(source, selected, handle);
  }
  function example() {
    editGraph(winRateGraph(L.types, currency, { won: B.statuses.won, closed: B.statuses.closed }));
    setUnit("percent");
    if (name.trim() === "") setName(L.winRate);
    select("result");
    setLayoutRevision((value) => value + 1);
  }
  function validate(): boolean {
    if (unsupportedManual) {
      setError(L.manualUnsupported);
      return false;
    }
    if (issues.length > 0) {
      setShowIssues(true);
      setError(L.invalidGraph);
      setTab("configure");
      select(issues[0]?.nodeId ?? selected, true);
      return false;
    }
    if (!kpiDefinitionInput.safeParse(definition).success) {
      setError(L.invalidDefinition);
      return false;
    }
    return true;
  }
  function errorMessage(id: string): string {
    if (id === "E_KPI_CONFLICT") return L.conflict;
    if (id === "E_KPI_NOT_READY") return L.notReady;
    if (id === "E_PERM_DENIED" || id === "E_AUTH_SESSION_DEAD") return L.permission;
    return L.failed;
  }
  function reportFailure(message: string) {
    if (alive.current) setError(message);
  }
  async function runPreview() {
    if (lock.current || disabled || !validate()) return;
    lock.current = true;
    setPending("preview");
    setError(null);
    setTab("preview");
    const generation = request.current;
    try {
      const today = instantCivilDate(new Date(), preferences.timeZone);
      const result = await previewKpiAction(
        definition,
        { scope: "company", scopeId: null },
        previewGraphPeriod(periodChoice, today),
        readCsrfToken(),
      );
      if (!alive.current || generation !== request.current) return;
      if (result.ok) setPreview({ fingerprint, period: periodChoice, measurement: result.value });
      else setError(errorMessage(result.error.id));
    } catch {
      if (alive.current) setError(L.failed);
    } finally {
      lock.current = false;
      if (alive.current) setPending(null);
    }
  }
  async function save() {
    if (lock.current || disabled || !validate()) return;
    if (currentPreview === null) {
      setError(L.previewRequired);
      return;
    }
    lock.current = true;
    setPending("save");
    setError(null);
    try {
      const result = await saveKpiDefinitionAction(
        {
          ...definition,
          ...(revision
            ? { familyId: initialDefinition.familyId, expectedRevision: initialDefinition.revision }
            : {}),
        },
        readCsrfToken(),
      );
      if (!alive.current) return;
      if (!result.ok) {
        setError(errorMessage(result.error.id));
        return;
      }
      setPublished(true);
      try {
        await onSaved();
        onOpenChange(false);
      } catch {
        reportFailure(L.savedRefreshFailed);
      }
    } catch {
      if (alive.current) setError(L.failed);
    } finally {
      lock.current = false;
      if (alive.current) setPending(null);
    }
  }
  function close() {
    if (lock.current) return;
    if (dirty) setDiscardOpen(true);
    else onOpenChange(false);
  }
  function discard() {
    if (!lock.current) {
      setDiscardOpen(false);
      onOpenChange(false);
    }
  }
  return {
    L,
    B,
    format,
    graph,
    definition,
    name,
    description,
    unit,
    currency,
    customUnit,
    history,
    selected,
    selectedNode,
    tab,
    setTab,
    periodChoice,
    pending,
    published,
    disabled,
    canManage,
    unsupportedManual,
    issues,
    invalidNodes,
    showIssues,
    error,
    preview,
    currentPreview,
    layoutRevision,
    reveal,
    revision,
    editGraph,
    editMetadata,
    select,
    moveHistory,
    addNode,
    changeNode,
    deleteNode,
    connect,
    input,
    example,
    runPreview,
    save,
    close,
    discard,
    discardOpen,
    setDiscardOpen,
    changePeriod: (value: GraphPeriodChoice) => {
      changed();
      setPeriodChoice(value);
    },
    arrange: () => {
      editGraph(arrangeKpiGraph(graph));
      setReveal(undefined);
      setLayoutRevision((value) => value + 1);
    },
    validConnection: (
      source: string,
      target: string,
      handle: KpiGraphHandle,
      previousId?: string,
    ) =>
      connectGraphInput(
        previousId === undefined
          ? graph
          : { ...graph, edges: graph.edges.filter((edge) => edge.id !== previousId) },
        source,
        target,
        handle,
      ) !== null,
  };
}
type EditorModel = ReturnType<typeof useGraphEditor>;

function EditorToolbar({ model }: { model: EditorModel }) {
  const {
    L,
    B,
    name,
    unit,
    currency,
    customUnit,
    disabled,
    pending,
    history,
    revision,
    currentPreview,
  } = model;
  return (
    <header className="shrink-0 border-b bg-background px-4 py-3 pe-14">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <DialogTitle className="text-sm font-medium">{L.title}</DialogTitle>
          <span className="text-muted-foreground">/</span>
          <Input
            aria-label={L.name}
            placeholder={L.namePlaceholder}
            value={name}
            maxLength={120}
            disabled={disabled}
            onChange={(event) => model.editMetadata({ name: event.target.value })}
            className="h-8 min-w-40 max-w-80 flex-1 border-transparent px-2 text-sm shadow-none hover:border-border focus-visible:border-ring"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled || history.past.length === 0}
            aria-label={L.undo}
            onClick={() => model.moveHistory("undo")}
          >
            <Undo2 className="size-3.5" aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled || history.future.length === 0}
            aria-label={L.redo}
            onClick={() => model.moveHistory("redo")}
          >
            <Redo2 className="size-3.5" aria-hidden />
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => void model.runPreview()}
          >
            {pending === "preview" ? (
              <LoaderCircle
                className="size-3.5 animate-spin motion-reduce:animate-none"
                aria-hidden
              />
            ) : (
              <Play className="size-3.5" aria-hidden />
            )}
            {L.preview}
          </Button>
          <Button
            size="sm"
            disabled={disabled || currentPreview === null}
            onClick={() => void model.save()}
          >
            {pending === "save" ? (
              <LoaderCircle
                className="size-3.5 animate-spin motion-reduce:animate-none"
                aria-hidden
              />
            ) : (
              <Save className="size-3.5" aria-hidden />
            )}
            {pending === "save" ? L.saving : revision ? L.publish : L.save}
          </Button>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
        <KpiGraphPalette
          graph={model.graph}
          onAdd={model.addNode}
          onExample={model.example}
          disabled={disabled}
        />
        <Button
          size="sm"
          variant="ghost"
          disabled={disabled}
          onClick={model.arrange}
          aria-label={L.arrange}
        >
          <LayoutGrid className="size-3.5" aria-hidden />
        </Button>
        <div className="min-w-40 max-w-64">
          <Select
            ariaLabel={L.selectNode}
            value={model.selected ?? ""}
            options={[
              { value: "", label: L.selectNode },
              ...model.graph.nodes.map((node, index) => ({
                value: node.id,
                label: `${model.format.number(index + 1)} · ${node.label}`,
              })),
            ]}
            onChange={(value) => model.select(value === "" ? null : value, true)}
            triggerClassName="h-8 text-xs"
          />
        </div>
        <span className="ms-auto text-xs text-muted-foreground">{L.unit}</span>
        <div className="w-36">
          <Select
            ariaLabel={L.unit}
            value={unit}
            disabled={disabled}
            options={KPI_UNITS.map((value) => ({ value, label: B.units[value] }))}
            onChange={(value) => model.editMetadata({ unit: value as KpiUnit })}
            triggerClassName="h-8 text-xs"
          />
        </div>
        {unit === "money" && (
          <div className="max-w-48">
            <CurrencySelect
              value={currency}
              onChange={(value) => model.editMetadata({ currency: value })}
            />
          </div>
        )}
        {unit === "custom" && (
          <Input
            aria-label={L.customUnit}
            placeholder={L.customUnit}
            maxLength={32}
            disabled={disabled}
            value={customUnit}
            onChange={(event) => model.editMetadata({ customUnit: event.target.value })}
            className="h-8 w-40 text-xs"
          />
        )}
      </div>
    </header>
  );
}
function EditorIssues({ model }: { model: EditorModel }) {
  const H = useKpiHubMessages();
  if (!model.showIssues || model.issues.length === 0) return null;
  return (
    <div className="max-h-28 shrink-0 overflow-y-auto border-b bg-muted/20 px-4 py-2">
      {model.issues.map((issue) => (
        <Button
          key={`${issue.nodeId ?? ""}:${issue.edgeId ?? ""}:${issue.code}`}
          variant="ghost"
          size="sm"
          className="h-auto w-full justify-start whitespace-normal py-1 text-start text-xs font-normal"
          onClick={() => {
            model.select(issue.nodeId ?? null, true);
            model.setTab("configure");
          }}
        >
          {model.graph.nodes.find((node) => node.id === issue.nodeId)?.label ?? model.L.result}:{" "}
          {H.issues[issue.code] ?? issueMessage(issue.code, model.L)}
        </Button>
      ))}
    </div>
  );
}
function EditorSidebar({ model, props }: { model: EditorModel; props: KpiGraphEditorProps }) {
  const { L } = model;
  return (
    <aside className="flex min-h-0 min-w-0 flex-col border-t bg-background lg:border-s lg:border-t-0">
      <div className="flex shrink-0 gap-1 border-b px-3 py-2">
        <Button
          variant={model.tab === "configure" ? "outline" : "ghost"}
          size="sm"
          aria-pressed={model.tab === "configure"}
          onClick={() => model.setTab("configure")}
        >
          {L.configure}
        </Button>
        <Button
          variant={model.tab === "preview" ? "outline" : "ghost"}
          size="sm"
          aria-pressed={model.tab === "preview"}
          onClick={() => model.setTab("preview")}
        >
          {L.preview}
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {model.tab === "configure" ? (
          <KpiGraphInspector
            node={model.selectedNode}
            graph={model.graph}
            onChange={model.changeNode}
            onInput={model.input}
            onDelete={model.deleteNode}
            disabled={model.disabled}
            baseCurrency={props.baseCurrency ?? "USD"}
            pipelines={props.pipelines ?? []}
            activityTypes={props.activityTypes ?? []}
            description={model.description}
            onDescription={(value) => model.editMetadata({ description: value })}
            result={model.currentPreview?.nodeResults?.find(
              (result) => result.nodeId === model.selected,
            )}
          />
        ) : (
          <div className="space-y-4 p-4">
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">{L.previewPeriod}</p>
              <Select
                ariaLabel={L.previewPeriod}
                value={model.periodChoice}
                disabled={model.disabled}
                options={Object.entries(L.periods).map(([value, label]) => ({ value, label }))}
                onChange={(value) => model.changePeriod(value as GraphPeriodChoice)}
              />
            </div>
            {model.currentPreview === null && (
              <p className="text-xs leading-relaxed text-muted-foreground">
                {model.preview === null ? L.previewEmpty : L.previewChanged}
              </p>
            )}
            <KpiPreview
              definition={model.definition}
              measurement={model.currentPreview}
              loading={model.pending === "preview"}
              error={null}
              changed={model.preview !== null && model.currentPreview === null}
            />
          </div>
        )}
      </div>
    </aside>
  );
}
function EditorSession(props: KpiGraphEditorProps) {
  const model = useGraphEditor(props);
  const returnFocus = useRef<HTMLElement | null>(
    typeof document !== "undefined" && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  return (
    <>
      <Dialog
        open={props.open}
        onOpenChange={(value) => {
          if (!value) model.close();
        }}
      >
        <DialogContent
          className="flex h-[calc(100dvh-16px)] w-[calc(100vw-16px)] max-w-none flex-col gap-0 overflow-hidden rounded-lg p-0 sm:max-w-none"
          onPointerDownOutside={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => {
            event.preventDefault();
            model.close();
          }}
          onCloseAutoFocus={(event) => {
            if (returnFocus.current?.isConnected === true) {
              event.preventDefault();
              returnFocus.current.focus();
            }
          }}
        >
          <EditorToolbar model={model} />
          <DialogDescription className="sr-only">{model.L.hint}</DialogDescription>
          {model.error !== null && (
            <p
              role="alert"
              className="shrink-0 border-b bg-destructive/5 px-4 py-2 text-xs text-destructive"
            >
              {model.error}
            </p>
          )}
          {!model.canManage && (
            <p role="alert" className="border-b px-4 py-2 text-xs text-muted-foreground">
              {model.L.permission}
            </p>
          )}
          {model.unsupportedManual && (
            <p role="alert" className="border-b px-4 py-2 text-xs text-muted-foreground">
              {model.L.manualUnsupported}
            </p>
          )}
          <EditorIssues model={model} />
          <div className="grid min-h-0 flex-1 grid-rows-[minmax(280px,1fr)_minmax(220px,44%)] lg:grid-cols-[minmax(0,1fr)_350px] lg:grid-rows-1">
            <KpiGraphCanvas
              graph={model.graph}
              selected={model.selected}
              onSelect={model.select}
              onChange={model.editGraph}
              onConnect={model.connect}
              isValidConnection={model.validConnection}
              disabled={model.disabled}
              invalidNodes={model.invalidNodes}
              nodeResults={model.currentPreview?.nodeResults}
              layoutRevision={model.layoutRevision}
              reveal={model.reveal}
            />
            <EditorSidebar model={model} props={props} />
          </div>
          <p className="shrink-0 border-t bg-background px-4 py-2 text-[10px] leading-relaxed text-muted-foreground">
            {model.L.keyboardHint}
          </p>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={model.discardOpen}
        onOpenChange={model.setDiscardOpen}
        title={model.L.discardTitle}
        description={model.L.discardDescription}
        confirmLabel={model.L.discard}
        cancelLabel={model.L.keepEditing}
        destructive
        onConfirm={model.discard}
      />
    </>
  );
}
export function KpiGraphEditor(props: KpiGraphEditorProps) {
  return props.open ? (
    <EditorSession
      key={`${props.initialDefinition?.id ?? "new"}:${props.duplicate === true ? "copy" : "edit"}`}
      {...props}
    />
  ) : null;
}
