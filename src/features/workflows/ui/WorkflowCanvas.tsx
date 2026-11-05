"use client";

import { Background, Controls, type EdgeChange, type NodeChange, ReactFlow } from "@xyflow/react";
import type { CSSProperties, Dispatch, SetStateAction } from "react";
import { useEffect, useId, useState } from "react";
import { useAppTranslations, useLocale } from "@/features/i18n/LocaleProvider";
import {
  type ConnectionProblem,
  disconnectNodes,
  edgeId,
  moveNode,
  removeNode,
} from "../graphEditor";
import { type NodeMeasurements, positionFor, positionForNewNode } from "../nodeLayout";
import { displayNodeName } from "../nodeNames";
import { orderedWorkflowNodes } from "../nodeOrder";
import type { NodePosition, WorkflowDefinition } from "../schemas";
import { ConnectionFeedback } from "./ConnectionFeedback";
import { conditionPortLabel } from "./conditionPortLabel";
import { ResponsiveViewport, type RevealNode } from "./ResponsiveViewport";
import { type AddFromOutput, useConnectionGestures } from "./useConnectionGestures";
import { type WorkflowCanvasEdge, WorkflowDiagramEdge } from "./WorkflowDiagramEdge";
import { WorkflowConnectionLine, WorkflowEdgeMarkers } from "./WorkflowEdgeMarkers";
import { type CanvasNode, WorkflowNodeCard } from "./WorkflowNodeCard";
import "@xyflow/react/dist/style.css";
import "./workflowCanvas.css";
import "./workflowTheme.css";

const nodeTypes = { workflow: WorkflowNodeCard };
const edgeTypes = { workflow: WorkflowDiagramEdge };

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
  onChangeType,
  onDuplicate,
  onNodeMeasurements,
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
  onChangeType?: (nodeId: string) => void;
  onDuplicate?: (nodeId: string) => void;
  onNodeMeasurements?: (measurements: NodeMeasurements) => void;
  reveal?: RevealNode;
  completedNodes?: Set<string>;
}) {
  const t = useAppTranslations("workflows");
  const locale = useLocale();
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
  const nodeIndices = new Map(
    orderedWorkflowNodes(definition).map((node, index) => [node.id, index]),
  );
  const uniqueIds = nodeIndices.size === definition.nodes.length;
  const nodes: CanvasNode[] = definition.nodes.map((node, index) => {
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
        onAdd: editable && onAdd !== undefined ? openOutput : undefined,
        onChangeType:
          editable && onChangeType !== undefined ? () => onChangeType(node.id) : undefined,
        onDuplicate:
          editable && !node.type.startsWith("trigger.") && onDuplicate !== undefined
            ? () => onDuplicate(node.id)
            : undefined,
        onConfigure: editable
          ? () => {
              onSelect(node.id);
              onSelectEdge(null);
            }
          : undefined,
        onRemove:
          editable && !node.type.startsWith("trigger.")
            ? () => removeCanvasNode(node.id)
            : undefined,
        outputs: definition.edges.filter((edge) => edge.from === node.id).map((edge) => edge.port),
      },
      position: { x: position.x, y: position.y },
      origin: storedPosition.anchor === "center" ? [0.5, 0.5] : [0, 0],
      measured: measurements.get(node.id),
      selected: selectedEdge === null && selected === node.id,
      deletable: editable && !node.type.startsWith("trigger."),
      ariaLabel: displayNodeName(node, locale),
    };
  });
  const edges: WorkflowCanvasEdge[] = definition.edges.map((spec) => ({
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
    label: spec.port === "next" ? undefined : t(conditionPortLabel(spec.port)),
    ariaLabel:
      t("connectionName", { from: nameFor(spec.from), to: nameFor(spec.to) }) +
      " · " +
      t(conditionPortLabel(spec.port)),
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
      removeCanvasNode(change.id);
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
      <ReactFlow
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
          onSelect(node.id);
          onSelectEdge(null);
        }}
        onEdgeClick={(_, edge) => onSelectEdge(edge.id)}
        onEdgeMouseEnter={(_, edge) => setHoveredEdge(edge.id)}
        onEdgeMouseLeave={() => setHoveredEdge(null)}
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
        <Background color="var(--workflow-border-medium)" size={2} />
        <Controls
          showInteractive={false}
          position={locale === "fa" ? "bottom-right" : "bottom-left"}
        />
      </ReactFlow>
    </section>
  );
}
