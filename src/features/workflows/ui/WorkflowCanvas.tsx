"use client";

import {
  Background,
  Controls,
  type EdgeChange,
  type NodeChange,
  ReactFlow,
  useUpdateNodeInternals,
} from "@xyflow/react";
import type { CSSProperties, Dispatch, SetStateAction } from "react";
import { useEffect, useId, useRef, useState } from "react";
import { useAppTranslations, useLocale } from "@/features/i18n/LocaleProvider";
import {
  type ConnectionProblem,
  disconnectNodes,
  edgeId,
  moveNode,
  removeNode,
} from "../graphEditor";
import { ifElsePorts } from "../ifElseBudget";
import { type NodeMeasurements, positionFor, positionForNewNode } from "../nodeLayout";
import { displayNodeName } from "../nodeNames";
import { orderedWorkflowNodes } from "../nodeOrder";
import type { NodePosition, WorkflowDefinition, WorkflowNode } from "../schemas";
import { ConnectionFeedback } from "./ConnectionFeedback";
import { useConditionPortLabel } from "./conditionPortLabel";
import { ResponsiveViewport, type RevealNode } from "./ResponsiveViewport";
import { type AddFromOutput, useConnectionGestures } from "./useConnectionGestures";
import { type WorkflowCanvasEdge, WorkflowDiagramEdge } from "./WorkflowDiagramEdge";
import { WorkflowConnectionLine, WorkflowEdgeMarkers } from "./WorkflowEdgeMarkers";
import { type CanvasNode, WorkflowNodeCard } from "./WorkflowNodeCard";
import { type PendingCanvasNode, WorkflowPendingStep } from "./WorkflowPendingStep";
import {
  type PendingInsertion,
  pendingEdgeId,
  pendingInsertionPosition,
  pendingStepId,
} from "./workflowPendingInsertion";
import "@xyflow/react/dist/style.css";
import "./workflowCanvas.css";
import "./workflowTheme.css";

type DiagramNode = CanvasNode | PendingCanvasNode;
const nodeTypes = { workflow: WorkflowNodeCard, pendingWorkflowStep: WorkflowPendingStep };
const edgeTypes = { workflow: WorkflowDiagramEdge };

function RefreshBranchHandles({ nodes }: { nodes: WorkflowDefinition["nodes"] }) {
  const refreshHandles = useUpdateNodeInternals();
  const previous = useRef(new Map<string, string>());
  useEffect(() => {
    const signatures = new Map<string, string>();
    const changed: string[] = [];
    for (const node of nodes) {
      if (node.type !== "ifElse") continue;
      const signature = ifElsePorts(node.config).join("|");
      signatures.set(node.id, signature);
      if (previous.current.get(node.id) !== signature) changed.push(node.id);
    }
    previous.current = signatures;
    if (changed.length > 0) refreshHandles(changed);
  }, [nodes, refreshHandles]);
  return null;
}

export function WorkflowCanvas({
  definition,
  selected,
  selectedEdge,
  onSelect,
  onSelectEdge,
  onClearSelection,
  onChange,
  onProblem,
  editable,
  invalidNodes,
  layoutRevision,
  onAdd,
  onChangeType,
  onDuplicate,
  pendingInsert,
  onNodeMeasurements,
  reveal,
  completedNodes,
}: {
  definition: WorkflowDefinition;
  selected: string;
  selectedEdge: string | null;
  onSelect: (id: string) => void;
  onSelectEdge: (id: string | null) => void;
  onClearSelection?: () => void;
  onChange: Dispatch<SetStateAction<WorkflowDefinition>>;
  onProblem: (problem: ConnectionProblem | null) => void;
  editable: boolean;
  invalidNodes: Set<string>;
  layoutRevision: number;
  onAdd?: AddFromOutput;
  onChangeType?: (nodeId: string) => void;
  onDuplicate?: (nodeId: string) => void;
  pendingInsert?: PendingInsertion & { focusPicker: () => void };
  onNodeMeasurements?: (measurements: NodeMeasurements) => void;
  reveal?: RevealNode;
  completedNodes?: Set<string>;
}) {
  const t = useAppTranslations("workflows");
  const locale = useLocale();
  const portLabel = useConditionPortLabel();
  const markerPrefix = `workflow-arrow-${useId().replaceAll(":", "")}`;
  const [hoveredEdge, setHoveredEdge] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [dragPositions, setDragPositions] = useState(new Map<string, { x: number; y: number }>());
  const gestures = useConnectionGestures({
    definition,
    editable,
    onChange,
    onProblem,
    onSelectEdge,
    onAdd: onAdd === undefined ? undefined : openOutput,
  });
  const [measurements, setMeasurements] = useState(
    new Map<string, { width: number; height: number }>(),
  );
  useEffect(() => {
    onNodeMeasurements?.(measurements);
  }, [measurements, onNodeMeasurements]);
  function openOutput(output: Parameters<AddFromOutput>[0], position?: NodePosition) {
    if (!editable || onAdd === undefined) return;
    onAdd(
      output,
      position === undefined
        ? positionForNewNode(definition, output.from, output, measurements)
        : { ...position, anchor: "center" },
    );
  }
  function nameFor(id: string) {
    const node = definition.nodes.find((item) => item.id === id);
    return node === undefined ? t("unavailableValue") : displayNodeName(node, locale);
  }
  function actionsFor(node: WorkflowNode) {
    const canRemove = editable && !node.type.startsWith("trigger.");
    return {
      onAdd: editable && onAdd !== undefined ? openOutput : undefined,
      onChangeType:
        editable && onChangeType !== undefined ? () => onChangeType(node.id) : undefined,
      onDuplicate: canRemove && onDuplicate !== undefined ? () => onDuplicate(node.id) : undefined,
      onConfigure: editable
        ? () => {
            onSelect(node.id);
            onSelectEdge(null);
          }
        : undefined,
      onRemove: canRemove ? () => removeCanvasNode(node.id) : undefined,
    };
  }
  const nodeIndices = new Map(
    orderedWorkflowNodes(definition).map((node, index) => [node.id, index]),
  );
  const uniqueIds = nodeIndices.size === definition.nodes.length;
  const pendingPosition =
    editable && pendingInsert !== undefined
      ? pendingInsertionPosition(definition, pendingInsert, selected, measurements)
      : null;
  const pendingSource = pendingPosition === null ? undefined : pendingInsert?.output;
  const nodes: DiagramNode[] = definition.nodes.map((node, index): CanvasNode => {
    const storedPosition = positionFor(definition, node.id);
    const position = dragPositions.get(node.id) ?? storedPosition;
    return {
      id: node.id,
      type: "workflow",
      data: {
        node,
        definition,
        invalid: invalidNodes.has(node.id),
        index: uniqueIds ? (nodeIndices.get(node.id) ?? index) : index,
        completed: completedNodes?.has(node.id) === true,
        ...actionsFor(node),
        outputs: [
          ...definition.edges.filter((edge) => edge.from === node.id).map((edge) => edge.port),
          ...(pendingSource?.from === node.id ? [pendingSource.port] : []),
        ],
      },
      position: { x: position.x, y: position.y },
      origin: storedPosition.anchor === "center" ? [0.5, 0.5] : [0, 0],
      measured: measurements.get(node.id),
      selected: selectedEdge === null && selected === node.id,
      deletable: editable && !node.type.startsWith("trigger."),
      ariaLabel: displayNodeName(node, locale),
    };
  });
  if (pendingPosition !== null && pendingInsert !== undefined) {
    nodes.push({
      id: pendingStepId,
      type: "pendingWorkflowStep",
      data: { focusPicker: pendingInsert.focusPicker },
      position: { x: pendingPosition.x, y: pendingPosition.y },
      origin: pendingPosition.anchor === "center" ? [0.5, 0.5] : [0, 0],
      measured: measurements.get(pendingStepId),
      ariaLabel: t("addAnAction"),
      draggable: false,
      selectable: false,
      deletable: false,
      connectable: false,
    });
  }
  const edges: WorkflowCanvasEdge[] = definition.edges.map((spec) => {
    const label = portLabel(
      spec.port,
      definition.nodes.find((node) => node.id === spec.from),
    );
    return {
      id: edgeId(spec),
      source: spec.from,
      target: spec.to,
      sourceHandle: spec.port,
      targetHandle: "in",
      type: "workflow",
      data: {
        spec,
        markerPrefix,
        hovered: hoveredEdge === edgeId(spec),
        completed: completedNodes?.has(spec.from) === true && completedNodes.has(spec.to),
        onInsert:
          editable && onAdd !== undefined
            ? (position) => openOutput({ from: spec.from, port: spec.port }, position)
            : undefined,
        onDisconnect: editable
          ? () => {
              onChange((graph) => disconnectNodes(graph, spec));
              onSelectEdge(null);
            }
          : undefined,
      },
      selected: selectedEdge === edgeId(spec),
      markerEnd: `${markerPrefix}-default`,
      label: spec.port === "next" ? undefined : label,
      ariaLabel: `${t("connectionName", { from: nameFor(spec.from), to: nameFor(spec.to) })} · ${label}`,
      deletable: editable,
      reconnectable: editable,
      interactionWidth: 28,
      style:
        completedNodes?.has(spec.from) === true && completedNodes.has(spec.to)
          ? { stroke: "hsl(var(--success))", strokeWidth: 2.5 }
          : undefined,
    };
  });
  if (pendingSource !== undefined) {
    edges.push({
      id: pendingEdgeId,
      source: pendingSource.from,
      sourceHandle: pendingSource.port,
      target: pendingStepId,
      targetHandle: "in",
      type: "workflow",
      data: { spec: { ...pendingSource, to: pendingStepId }, markerPrefix, hovered: false },
      markerEnd: `${markerPrefix}-default`,
      deletable: false,
      reconnectable: false,
      selectable: false,
    });
  }
  function recordMeasurement(id: string, dimensions: { width: number; height: number }) {
    setMeasurements((previous) => {
      const current = previous.get(id);
      if (current?.width === dimensions.width && current.height === dimensions.height)
        return previous;
      return new Map(previous).set(id, dimensions);
    });
  }
  function removeCanvasNode(id: string) {
    if (
      !editable ||
      !definition.nodes.some((node) => node.id === id && !node.type.startsWith("trigger."))
    )
      return;
    onChange((graph) => removeNode(graph, id));
    onSelect("");
    onSelectEdge(null);
  }
  function applyGraphNodeChange(change: NodeChange<DiagramNode>) {
    if (!editable) return;
    if (change.type === "position" && change.position !== undefined) {
      const position = change.position;
      setDragPositions((previous) => {
        const next = new Map(previous);
        if (change.dragging === true) next.set(change.id, position);
        else next.delete(change.id);
        return next;
      });
      if (change.dragging !== true) onChange((graph) => moveNode(graph, change.id, position));
    }
    if (change.type === "remove") {
      removeCanvasNode(change.id);
    }
  }
  function nodeChanges(changes: NodeChange<DiagramNode>[]) {
    for (const change of changes) {
      if (change.type === "dimensions" && change.dimensions !== undefined)
        recordMeasurement(change.id, change.dimensions);
      if ("id" in change && change.id === pendingStepId) continue;
      if (change.type === "select" && change.selected) {
        onSelect(change.id);
        onSelectEdge(null);
      }
      applyGraphNodeChange(change);
    }
  }
  function edgeChanges(changes: EdgeChange<WorkflowCanvasEdge>[]) {
    for (const change of changes) {
      if (change.type === "select" && change.selected) onSelectEdge(change.id);
      if (change.type === "remove" && editable) {
        const spec = definition.edges.find((edge) => edgeId(edge) === change.id);
        if (spec !== undefined) onChange((graph) => disconnectNodes(graph, spec));
        onSelectEdge(null);
      }
    }
  }
  return (
    <section
      dir="ltr"
      aria-label={t("canvas")}
      className="workflow-twenty-theme workflow-canvas relative h-full min-h-0 min-w-0 flex-1"
      data-dragging={dragging}
      data-editable={editable}
      style={{ "--workflow-connection-marker": `url(#${markerPrefix}-selected)` } as CSSProperties}
    >
      <WorkflowEdgeMarkers prefix={markerPrefix} />
      <ReactFlow<DiagramNode, WorkflowCanvasEdge>
        key={layoutRevision}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodeOrigin={[0.5, 0.5]}
        defaultViewport={{ x: 0, y: 150, zoom: 1 }}
        minZoom={0.1}
        nodeExtent={[
          [-100000, -100000],
          [100000, 100000],
        ]}
        nodesDraggable={editable}
        nodesConnectable={editable}
        edgesReconnectable={editable}
        onNodesChange={nodeChanges}
        onEdgesChange={edgeChanges}
        onConnect={gestures.connect}
        isValidConnection={gestures.isValidConnection}
        connectionRadius={32}
        connectionDragThreshold={4}
        connectionLineComponent={WorkflowConnectionLine}
        onInit={gestures.initialize}
        onConnectStart={() => onProblem(null)}
        onConnectEnd={gestures.finish}
        onReconnectStart={(_, edge) => gestures.startReconnect(edge.data?.spec)}
        onReconnect={(edge, connection) => gestures.connect(connection, edge.data?.spec)}
        onReconnectEnd={gestures.endReconnect}
        onNodeClick={(_, node) => {
          if (node.type === "pendingWorkflowStep") {
            node.data.focusPicker();
            return;
          }
          onSelect(node.id);
          onSelectEdge(null);
        }}
        onEdgeClick={(_, edge) => {
          if (edge.id !== pendingEdgeId) onSelectEdge(edge.id);
        }}
        onEdgeMouseEnter={(_, edge) => setHoveredEdge(edge.id)}
        onEdgeMouseLeave={() => setHoveredEdge(null)}
        onPaneClick={() => {
          if (onClearSelection !== undefined) onClearSelection();
          else onSelectEdge(null);
        }}
        onNodeDragStart={() => setDragging(true)}
        onNodeDragStop={() => setDragging(false)}
        proOptions={{ hideAttribution: true }}
        multiSelectionKeyCode={null}
        selectionKeyCode={null}
        deleteKeyCode={editable ? ["Backspace", "Delete"] : null}
        ariaLabelConfig={{
          "controls.ariaLabel": t("canvasTools"),
          "node.a11yDescription.default": t("nodeKeyboard"),
          "node.a11yDescription.keyboardDisabled": t("nodeDescription"),
          "node.a11yDescription.ariaLiveMessage": ({ x, y }) =>
            t("nodeMoved", { x: String(Math.round(x)), y: String(Math.round(y)) }),
          "edge.a11yDescription.default": t("edgeKeyboard"),
          "handle.ariaLabel": t("connectHint"),
          "controls.zoomIn.ariaLabel": t("zoomIn"),
          "controls.zoomOut.ariaLabel": t("zoomOut"),
          "controls.fitView.ariaLabel": t("fitView"),
        }}
      >
        <RefreshBranchHandles nodes={definition.nodes} />
        <ResponsiveViewport reveal={reveal} />
        <ConnectionFeedback occupied={definition.edges} />
        <Background color="var(--workflow-border-medium)" size={2} />
        <Controls
          showInteractive={false}
          position={locale === "fa" ? "bottom-right" : "bottom-left"}
        />
      </ReactFlow>
    </section>
  );
}
