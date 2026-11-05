"use client";
import {
  Background,
  type Connection,
  Controls,
  type EdgeChange,
  type NodeChange,
  ReactFlow,
} from "@xyflow/react";
import { type CSSProperties, useId, useRef, useState } from "react";
import type { WorkflowV2Definition } from "@/features/blocks/contracts";
import { useSharedBlocksMessages } from "@/features/blocks/sharedBlocksMessages";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import type { WorkflowEdge } from "@/features/workflows/schemas";
import { ResponsiveViewport } from "@/features/workflows/ui/ResponsiveViewport";
import {
  type WorkflowCanvasEdge,
  WorkflowDiagramEdge,
} from "@/features/workflows/ui/WorkflowDiagramEdge";
import {
  WorkflowConnectionLine,
  WorkflowEdgeMarkers,
} from "@/features/workflows/ui/WorkflowEdgeMarkers";
import {
  type PendingCanvasNode,
  WorkflowPendingStep,
} from "@/features/workflows/ui/WorkflowPendingStep";
import { pendingEdgeId, pendingStepId } from "@/features/workflows/ui/workflowPendingInsertion";
import { StudioDiagramNode, type StudioNode, studioPortLabel } from "./StudioDiagramNode";
import styles from "./studioDiagram.module.css";
import { arrangeStudio, connectStudioNodes, portsForNode, removeStudioNode } from "./studioModel";
import "@xyflow/react/dist/style.css";
import "@/features/workflows/ui/workflowCanvas.css";
import "@/features/workflows/ui/workflowTheme.css";

type DiagramNode = StudioNode | PendingCanvasNode;
const nodeTypes = { studio: StudioDiagramNode, pendingWorkflowStep: WorkflowPendingStep };
type PendingOutput = { source: string; port: string };

function diagramPort(port: string): WorkflowEdge["port"] {
  return port === "next" || port === "loop" || port === "done" ? port : `branch:${port}`;
}

function canShowPending(
  definition: WorkflowV2Definition,
  pending: PendingOutput,
  connections: WorkflowV2Definition["edges"],
) {
  const source = definition.nodes.find((node) => node.id === pending.source);
  const ports =
    source === undefined ? (pending.source === "$trigger" ? ["next"] : []) : portsForNode(source);
  return (
    ports.includes(pending.port) &&
    !connections.some((edge) => edge.source === pending.source && edge.sourcePort === pending.port)
  );
}

const edgeTypes = { twenty: WorkflowDiagramEdge };

export function WorkflowStudioCanvas({
  definition,
  selected,
  disabled,
  onSelect,
  onChange,
  onClearSelection,
  onInsert,
  onChangeType,
  onDuplicate,
  pending,
  onFocusPicker,
  reveal,
  layoutRevision,
}: {
  definition: WorkflowV2Definition;
  selected: string;
  disabled: boolean;
  onSelect: (id: string) => void;
  onChange: (definition: WorkflowV2Definition) => void;
  onClearSelection?: () => void;
  onInsert?: (source: string, port: string, edgeId?: string) => void;
  onChangeType?: (id: string) => void;
  onDuplicate?: (id: string) => void;
  pending?: PendingOutput;
  onFocusPicker?: () => void;
  reveal?: { id: string; nonce: number };
  layoutRevision: number;
}) {
  const L = useSharedBlocksMessages();
  const t = useAppTranslations("workflows");
  const canvasRef = useRef<HTMLElement>(null);
  const markerPrefix = `studio-arrow-${useId().replaceAll(":", "")}`;
  const [hoveredEdge, setHoveredEdge] = useState<string | null>(null);
  const [sizes, setSizes] = useState(new Map<string, { width: number; height: number }>());
  const [positions, setPositions] = useState(new Map<string, { x: number; y: number }>());
  const layout = definition.layout ?? arrangeStudio(definition).layout ?? {};
  const specs = [
    { id: "$trigger", node: undefined },
    ...definition.nodes.map((node) => ({ id: node.id, node })),
  ];
  const connections = [
    ...definition.edges,
    ...definition.entryNodeIds.map((id) => ({
      id: `$trigger:${id}`,
      source: "$trigger",
      target: id,
      sourcePort: "next",
    })),
  ];
  const pendingOutput =
    pending !== undefined && canShowPending(definition, pending, connections) ? pending : undefined;
  const nodes: DiagramNode[] = specs.map((spec) => ({
    id: spec.id,
    type: "studio",
    position: positions.get(spec.id) ?? layout[spec.id] ?? { x: 0, y: 0 },
    measured: sizes.get(spec.id),
    data: {
      node: spec.node,
      trigger: definition.trigger.type,
      connectedPorts: new Set([
        ...connections.filter((edge) => edge.source === spec.id).map((edge) => edge.sourcePort),
        ...(pendingOutput?.source === spec.id ? [pendingOutput.port] : []),
      ]),
      onAdd: disabled || onInsert === undefined ? undefined : (port) => onInsert(spec.id, port),
      onChangeType:
        disabled || spec.node === undefined || onChangeType === undefined
          ? undefined
          : () => onChangeType(spec.id),
      onDuplicate:
        disabled ||
        spec.node === undefined ||
        definition.nodes.length >= 100 ||
        onDuplicate === undefined
          ? undefined
          : () => onDuplicate(spec.id),
      onRemove:
        disabled || spec.node === undefined
          ? undefined
          : () => {
              onChange(removeStudioNode(definition, spec.id));
              onClearSelection?.();
            },
    },
    selected: pendingOutput === undefined && selected === spec.id,
    deletable: !disabled && spec.id !== "$trigger",
    ariaLabel: spec.node?.name ?? L.trigger,
  }));
  const edges: WorkflowCanvasEdge[] = connections.map(({ id, source, target, sourcePort }) => ({
    id,
    source,
    target,
    sourceHandle: sourcePort,
    targetHandle: "in",
    type: "twenty",
    label:
      sourcePort === "next"
        ? undefined
        : studioPortLabel(
            L,
            definition.nodes.find((node) => node.id === source),
            sourcePort,
          ),
    data: {
      spec: {
        from: source,
        to: target,
        port: diagramPort(sourcePort),
      },
      markerPrefix,
      hovered: id === hoveredEdge,
      onInsert:
        disabled || onInsert === undefined ? undefined : () => onInsert(source, sourcePort, id),
      onDisconnect: disabled ? undefined : () => edgeChanges([{ id, type: "remove" }]),
    },
  }));
  if (pendingOutput !== undefined) {
    const { source, port } = pendingOutput;
    const origin = positions.get(source) ?? layout[source] ?? { x: 0, y: 0 };
    const position =
      port === "loop"
        ? { x: origin.x + 200, y: origin.y + 150 }
        : { x: origin.x, y: origin.y + 150 };
    nodes.push({
      id: pendingStepId,
      type: "pendingWorkflowStep",
      position,
      measured: sizes.get(pendingStepId),
      ariaLabel: t("addAnAction"),
      draggable: false,
      selectable: false,
      deletable: false,
      data: {
        focusPicker:
          onFocusPicker ??
          (() => {
            canvasRef.current?.parentElement?.parentElement
              ?.querySelector<HTMLElement>(
                "[data-studio-action-picker] button:not(:disabled), [data-studio-action-picker] a",
              )
              ?.focus();
          }),
      },
    });
    edges.push({
      id: pendingEdgeId,
      source,
      target: pendingStepId,
      sourceHandle: port,
      targetHandle: "in",
      type: "twenty",
      selectable: false,
      deletable: false,
      data: { spec: { from: source, to: pendingStepId, port: diagramPort(port) }, markerPrefix },
    });
  }
  function applyPosition(
    current: WorkflowV2Definition,
    change: Extract<NodeChange<DiagramNode>, { type: "position" }>,
  ) {
    const { id, position } = change;
    if (position === undefined || id === pendingStepId) return current;
    setPositions((previous) => {
      const result = new Map(previous);
      if (change.dragging === true) result.set(id, position);
      else result.delete(id);
      return result;
    });
    return change.dragging === true
      ? current
      : { ...current, layout: { ...(current.layout ?? layout), [id]: position } };
  }
  function changes(values: NodeChange<DiagramNode>[]) {
    let next = definition;
    for (const change of values) {
      switch (change.type) {
        case "dimensions": {
          const dimensions = change.dimensions;
          if (dimensions !== undefined)
            setSizes((current) => new Map(current).set(change.id, dimensions));
          break;
        }
        case "remove":
          if (!disabled && change.id !== pendingStepId) next = removeStudioNode(next, change.id);
          break;
        case "position":
          if (!disabled) next = applyPosition(next, change);
          break;
        case "add":
        case "replace":
        case "select":
          break;
      }
    }
    if (next !== definition) onChange(next);
  }
  function edgeChanges(values: EdgeChange[]) {
    if (disabled) return;
    const removed = new Set(
      values.filter((change) => change.type === "remove").map((change) => change.id),
    );
    if (removed.size === 0) return;
    onChange({
      ...definition,
      edges: definition.edges.filter((edge) => !removed.has(edge.id)),
      entryNodeIds: definition.entryNodeIds.filter((id) => !removed.has(`$trigger:${id}`)),
    });
  }
  function connect(connection: Connection) {
    if (connection.source === pendingStepId || connection.target === pendingStepId) return;
    const next = connectStudioNodes(
      definition,
      connection.source,
      connection.target,
      connection.sourceHandle ?? "next",
    );
    if (next !== null) onChange(next);
  }
  return (
    <section
      ref={canvasRef}
      aria-label={L.title}
      dir="ltr"
      className={`workflow-twenty-theme workflow-canvas ${styles.diagram}`}
      data-editable={!disabled}
      style={{ "--workflow-connection-marker": `url(#${markerPrefix}-selected)` } as CSSProperties}
      onKeyDownCapture={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        if (!(event.target instanceof HTMLElement)) return;
        const node = event.target.closest<HTMLElement>(".react-flow__node");
        if (
          node !== null &&
          event.target === node &&
          node.dataset.id !== undefined &&
          node.dataset.id !== pendingStepId
        )
          onSelect(node.dataset.id);
      }}
    >
      <WorkflowEdgeMarkers prefix={markerPrefix} />
      <ReactFlow
        key={layoutRevision}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodeOrigin={[0.5, 0.5]}
        onEdgeMouseEnter={(_, edge) => setHoveredEdge(edge.id)}
        onEdgeMouseLeave={() => setHoveredEdge(null)}
        proOptions={{ hideAttribution: true }}
        onNodesChange={changes}
        onEdgesChange={edgeChanges}
        onNodeClick={(_, node) => {
          if (node.id !== pendingStepId) onSelect(node.id);
        }}
        onPaneClick={onClearSelection}
        onConnect={connect}
        isValidConnection={(connection) =>
          connection.source !== pendingStepId &&
          connection.target !== pendingStepId &&
          connectStudioNodes(
            definition,
            connection.source,
            connection.target,
            connection.sourceHandle ?? "next",
          ) !== null
        }
        nodesDraggable={!disabled}
        nodesConnectable={!disabled}
        deleteKeyCode={disabled ? null : ["Backspace", "Delete"]}
        multiSelectionKeyCode={null}
        fitView
        fitViewOptions={{ padding: 0.3, maxZoom: 1.05 }}
        minZoom={0.15}
        maxZoom={1.8}
        connectionLineComponent={WorkflowConnectionLine}
      >
        <ResponsiveViewport reveal={reveal} />
        <Background color="var(--workflow-border-medium)" size={2} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </section>
  );
}
