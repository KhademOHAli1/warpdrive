"use client";

import {
  Background,
  ConnectionLineType,
  Controls,
  type Edge,
  type EdgeChange,
  MarkerType,
  type NodeChange,
  ReactFlow,
} from "@xyflow/react";
import type { Dispatch, SetStateAction } from "react";
import { useState } from "react";
import { useAppTranslations, useLocale } from "@/features/i18n/LocaleProvider";
import {
  type ConnectionProblem,
  disconnectNodes,
  edgeId,
  moveNode,
  removeNode,
} from "../graphEditor";
import { positionFor } from "../nodeLayout";
import { displayNodeName } from "../nodeNames";
import type { WorkflowDefinition, WorkflowEdge } from "../schemas";
import { ConnectionFeedback } from "./ConnectionFeedback";
import { ResponsiveViewport, type RevealNode } from "./ResponsiveViewport";
import { type AddFromOutput, useConnectionGestures } from "./useConnectionGestures";
import { type CanvasNode, WorkflowNodeCard } from "./WorkflowNodeCard";
import "@xyflow/react/dist/style.css";
import "./workflowCanvas.css";

const nodeTypes = { workflow: WorkflowNodeCard };
type CanvasEdge = Edge<{ spec: WorkflowEdge }>;

export function WorkflowCanvas({
  definition,
  selected,
  selectedEdge,
  onSelect,
  onSelectEdge,
  onChange,
  onProblem,
  editable,
  invalidNodes,
  layoutRevision,
  onAdd,
  reveal,
  completedNodes,
}: {
  definition: WorkflowDefinition;
  selected: string;
  selectedEdge: string | null;
  onSelect: (id: string) => void;
  onSelectEdge: (id: string | null) => void;
  onChange: Dispatch<SetStateAction<WorkflowDefinition>>;
  onProblem: (problem: ConnectionProblem | null) => void;
  editable: boolean;
  invalidNodes: Set<string>;
  layoutRevision: number;
  onAdd?: AddFromOutput;
  reveal?: RevealNode;
  completedNodes?: Set<string>;
}) {
  const t = useAppTranslations("workflows");
  const locale = useLocale();
  const [dragging, setDragging] = useState(false);
  const [dragPositions, setDragPositions] = useState(new Map<string, { x: number; y: number }>());
  const gestures = useConnectionGestures({
    definition,
    editable,
    onChange,
    onProblem,
    onSelectEdge,
    onAdd,
  });
  const [measurements, setMeasurements] = useState(
    new Map<string, { width: number; height: number }>(),
  );
  function nameFor(id: string) {
    const node = definition.nodes.find((item) => item.id === id);
    return node === undefined ? t("unavailableValue") : displayNodeName(node, locale);
  }
  const nodes: CanvasNode[] = definition.nodes.map((node, index) => ({
    id: node.id,
    type: "workflow",
    data: {
      node,
      invalid: invalidNodes.has(node.id),
      index,
      completed: completedNodes?.has(node.id) === true,
      onAdd: editable ? onAdd : undefined,
      outputs: definition.edges.filter((edge) => edge.from === node.id).map((edge) => edge.port),
    },
    position: dragPositions.get(node.id) ?? positionFor(definition, node.id),
    measured: measurements.get(node.id),
    selected: selectedEdge === null && selected === node.id,
    deletable: editable && !node.type.startsWith("trigger."),
    ariaLabel: displayNodeName(node, locale),
  }));
  const edges: CanvasEdge[] = definition.edges.map((spec) => ({
    id: edgeId(spec),
    source: spec.from,
    target: spec.to,
    sourceHandle: spec.port,
    targetHandle: "in",
    type: "smoothstep",
    data: { spec },
    selected: selectedEdge === edgeId(spec),
    markerEnd: { type: MarkerType.ArrowClosed },
    label: spec.port === "next" ? undefined : t(spec.port === "true" ? "truePort" : "falsePort"),
    ariaLabel: t("connectionName", { from: nameFor(spec.from), to: nameFor(spec.to) }),
    deletable: editable,
    reconnectable: editable,
    interactionWidth: 28,
    style:
      completedNodes?.has(spec.from) === true && completedNodes.has(spec.to)
        ? { stroke: "hsl(var(--success))", strokeWidth: 2.5 }
        : undefined,
  }));
  function recordMeasurement(id: string, dimensions: { width: number; height: number }) {
    setMeasurements((previous) => {
      const current = previous.get(id);
      if (current?.width === dimensions.width && current.height === dimensions.height)
        return previous;
      return new Map(previous).set(id, dimensions);
    });
  }
  function applyGraphNodeChange(change: NodeChange<CanvasNode>) {
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
      onChange((graph) => removeNode(graph, change.id));
      onSelect(definition.nodes.find((node) => node.id !== change.id)?.id ?? "start");
    }
  }
  function nodeChanges(changes: NodeChange<CanvasNode>[]) {
    for (const change of changes) {
      if (change.type === "dimensions" && change.dimensions !== undefined)
        recordMeasurement(change.id, change.dimensions);
      if (change.type === "select" && change.selected) {
        onSelect(change.id);
        onSelectEdge(null);
      }
      applyGraphNodeChange(change);
    }
  }
  function edgeChanges(changes: EdgeChange<CanvasEdge>[]) {
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
      className="workflow-canvas relative h-[440px] min-w-0 bg-muted/20 xl:h-auto xl:min-h-0 xl:flex-1"
      data-dragging={dragging}
    >
      <ReactFlow
        key={layoutRevision}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.1}
        fitViewOptions={{ padding: 0.12, minZoom: 0.75, maxZoom: 1.1 }}
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
        connectionLineType={ConnectionLineType.SmoothStep}
        onInit={gestures.initialize}
        onConnectStart={() => onProblem(null)}
        onConnectEnd={gestures.finish}
        onReconnectStart={(_, edge) => gestures.startReconnect(edge.data?.spec)}
        onReconnect={(edge, connection) => gestures.connect(connection, edge.data?.spec)}
        onReconnectEnd={gestures.endReconnect}
        onNodeClick={(_, node) => {
          onSelect(node.id);
          onSelectEdge(null);
        }}
        onEdgeClick={(_, edge) => onSelectEdge(edge.id)}
        onPaneClick={() => onSelectEdge(null)}
        onNodeDragStart={() => setDragging(true)}
        onNodeDragStop={() => setDragging(false)}
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
        <ResponsiveViewport reveal={reveal} />
        <ConnectionFeedback occupied={definition.edges} />
        <Background gap={22} size={1} />
        <Controls
          showInteractive={false}
          position={locale === "fa" ? "bottom-right" : "bottom-left"}
        />
      </ReactFlow>
    </section>
  );
}
