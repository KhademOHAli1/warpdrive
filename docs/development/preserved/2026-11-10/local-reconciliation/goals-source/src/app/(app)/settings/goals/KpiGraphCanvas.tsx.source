"use client";

import {
  Background,
  ConnectionLineType,
  Controls,
  type Connection,
  type Edge,
  type EdgeChange,
  Handle,
  MarkerType,
  type Node,
  type NodeChange,
  type NodeProps,
  Position,
  ReactFlow,
} from "@xyflow/react";
import { Calculator, Database, GitBranch, Hash, Network, Target } from "lucide-react";
import { useRef, useState } from "react";
import { useKpiGraphMessages } from "@/features/goals/kpiGraphMessages";
import { useKpiMessages } from "@/features/goals/kpiMessages";
import type {
  KpiGraph,
  KpiGraphHandle,
  KpiGraphNode,
  KpiGraphNodeResult,
} from "@/features/goals/kpiModel";
import { kpiGraphInputHandles } from "@/features/goals/kpiGraphValidation";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { ResponsiveViewport } from "@/features/workflows/ui/ResponsiveViewport";
import { useFormatters } from "@/lib/useFormatters";
import { cn } from "@/lib/utils";
import { removeGraphNode } from "./KpiGraphModel";
import "@xyflow/react/dist/style.css";
import "@/features/workflows/ui/workflowCanvas.css";

type CanvasNode = Node<
  { spec: KpiGraphNode; graph: KpiGraph; invalid: boolean; result?: KpiGraphNodeResult },
  "kpi"
>;
const icons = {
  metric: Database,
  constant: Hash,
  compute: Calculator,
  compare: GitBranch,
  logic: Network,
  branch: GitBranch,
  output: Target,
};

function KpiNode({ data, selected, isConnectable }: NodeProps<CanvasNode>) {
  const L = useKpiGraphMessages();
  const B = useKpiMessages();
  const format = useFormatters();
  const { locale } = useLocalePreferences();
  const { spec, graph, result } = data;
  const Icon = icons[spec.type];
  const inputs = kpiGraphInputHandles(spec, graph);
  const subtitle = () => {
    switch (spec.type) {
      case "metric":
        return `${B.sources[spec.metric.source]} · ${B.calculations[spec.metric.calculation]}`;
      case "constant":
        return spec.value;
      case "compute":
        return L.operations[spec.operation];
      case "compare":
        return L.comparisons[spec.operator];
      case "logic":
        return L.gates[spec.operation];
      case "branch":
        return L.condition;
      case "output":
        return L.result;
    }
  };
  const resultText = () => {
    if (result === undefined) return null;
    if (result.value === null)
      return L[result.state === "available" ? "unavailable" : result.state];
    if (typeof result.value === "boolean") return result.value ? L.trueValue : L.falseValue;
    return format.number(result.value, { maximumFractionDigits: 4 });
  };
  return (
    <div
      dir={locale === "fa" ? "rtl" : "ltr"}
      className={cn(
        "relative w-[228px] rounded-md border bg-card px-3 py-3 text-start shadow-[0_1px_2px_rgb(0_0_0/0.04)]",
        selected ? "border-link ring-2 ring-link/15" : "border-border",
        data.invalid && "border-destructive/60",
      )}
    >
      {inputs.map((input, index) => (
        <Handle
          key={input.handle}
          id={input.handle}
          type="target"
          position={Position.Top}
          isConnectable={isConnectable}
          style={{ left: `${((index + 1) * 100) / (inputs.length + 1)}%` }}
          aria-label={`${spec.label}: ${L[input.handle === "value" ? "outputValue" : input.handle === "true" ? "trueRoute" : input.handle === "false" ? "falseRoute" : input.handle]}`}
        />
      ))}
      <div className="flex items-center gap-2.5">
        <span className="flex size-7 shrink-0 items-center justify-center rounded border bg-muted/30 text-muted-foreground">
          <Icon className="size-3.5" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-[10px] leading-4 text-muted-foreground">{L.types[spec.type]}</p>
          <p className="truncate text-xs font-medium leading-5" dir="auto">
            {spec.label}
          </p>
        </div>
      </div>
      <p className="mt-2 truncate text-[10px] leading-4 text-muted-foreground" dir="auto">
        {subtitle()}
      </p>
      {result !== undefined && (
        <p
          className="mt-2 border-t pt-1.5 text-[11px] tabular-nums text-muted-foreground"
          aria-label={L.nodeOutput}
        >
          {resultText()}
        </p>
      )}
      {spec.type !== "output" && (
        <Handle
          id="value"
          type="source"
          position={Position.Bottom}
          isConnectable={isConnectable}
          aria-label={`${spec.label}: ${L.outputPort}`}
        />
      )}
    </div>
  );
}
const nodeTypes = { kpi: KpiNode };

export interface KpiGraphCanvasProps {
  graph: KpiGraph;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onChange: (graph: KpiGraph) => void;
  onConnect: (source: string, target: string, handle: KpiGraphHandle, previousId?: string) => void;
  isValidConnection: (
    source: string,
    target: string,
    handle: KpiGraphHandle,
    previousId?: string,
  ) => boolean;
  disabled: boolean;
  invalidNodes: Set<string>;
  nodeResults?: KpiGraphNodeResult[];
  layoutRevision: number;
  reveal: { id: string; nonce: number } | undefined;
}
export function KpiGraphCanvas({
  graph,
  selected,
  onSelect,
  onChange,
  onConnect,
  isValidConnection,
  disabled,
  invalidNodes,
  nodeResults,
  layoutRevision,
  reveal,
}: KpiGraphCanvasProps) {
  const L = useKpiGraphMessages();
  const { locale } = useLocalePreferences();
  const reconnecting = useRef<string | undefined>(undefined);
  const [positions, setPositions] = useState(new Map<string, { x: number; y: number }>());
  const [measurements, setMeasurements] = useState(
    new Map<string, { width: number; height: number }>(),
  );
  const [dragging, setDragging] = useState(false);
  const nodes: CanvasNode[] = graph.nodes.map((spec) => ({
    id: spec.id,
    type: "kpi",
    data: {
      spec,
      graph,
      invalid: invalidNodes.has(spec.id),
      result: nodeResults?.find((result) => result.nodeId === spec.id),
    },
    position: positions.get(spec.id) ?? spec.position,
    selected: selected === spec.id,
    measured: measurements.get(spec.id),
    deletable: !disabled,
    ariaLabel: spec.label,
  }));
  const edges: Edge[] = graph.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: "value",
    targetHandle: edge.targetHandle,
    type: "smoothstep",
    markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
    interactionWidth: 24,
    label: edge.targetHandle === "condition" ? L.condition : undefined,
    deletable: !disabled,
    reconnectable: !disabled,
  }));
  function nodeChanges(changes: NodeChange<CanvasNode>[]) {
    for (const change of changes) {
      if (change.type === "dimensions" && change.dimensions !== undefined) {
        const dimensions = change.dimensions;
        setMeasurements((current) => new Map(current).set(change.id, dimensions));
      }
      // Selection is owned by explicit click/keyboard intent. XYFlow also emits selection
      // changes while reconciling controlled nodes; replaying those can replace the inspector
      // selection after a user has already opened an input picker for a different node.
      if (disabled) continue;
      if (change.type === "remove") {
        onChange(removeGraphNode(graph, change.id));
        onSelect(null);
      }
      if (change.type === "position" && change.position !== undefined) {
        const position = change.position;
        setPositions((current) => {
          const next = new Map(current);
          if (change.dragging === true) next.set(change.id, position);
          else next.delete(change.id);
          return next;
        });
        if (change.dragging !== true)
          onChange({
            ...graph,
            nodes: graph.nodes.map((node) =>
              node.id === change.id ? { ...node, position } : node,
            ),
          });
      }
    }
  }
  function edgeChanges(changes: EdgeChange[]) {
    if (disabled) return;
    const removed = new Set(
      changes.filter((change) => change.type === "remove").map((change) => change.id),
    );
    if (removed.size > 0)
      onChange({ ...graph, edges: graph.edges.filter((edge) => !removed.has(edge.id)) });
  }
  function connect(connection: Connection, previousId = reconnecting.current) {
    if (connection.targetHandle === null) return;
    onConnect(
      connection.source,
      connection.target,
      connection.targetHandle as KpiGraphHandle,
      previousId,
    );
  }
  return (
    <section
      dir="ltr"
      aria-label={L.canvas}
      className="workflow-canvas relative min-h-[340px] min-w-0 flex-1 bg-muted/15"
      data-dragging={dragging}
      onKeyDownCapture={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        if (!(event.target instanceof HTMLElement)) return;
        const node = event.target.closest<HTMLElement>(".react-flow__node");
        if (node !== null && event.target === node && node.dataset.id !== undefined)
          onSelect(node.dataset.id);
      }}
    >
      <ReactFlow
        key={layoutRevision}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.25, minZoom: 0.6, maxZoom: 1.05 }}
        minZoom={0.15}
        maxZoom={1.8}
        nodesDraggable={!disabled}
        nodesConnectable={!disabled}
        edgesReconnectable={!disabled}
        onNodesChange={nodeChanges}
        onEdgesChange={edgeChanges}
        onConnect={connect}
        isValidConnection={(connection) =>
          connection.targetHandle !== null &&
          isValidConnection(
            connection.source,
            connection.target,
            connection.targetHandle as KpiGraphHandle,
            reconnecting.current,
          )
        }
        connectionLineType={ConnectionLineType.SmoothStep}
        connectionRadius={28}
        onReconnectStart={(_, edge) => {
          reconnecting.current = edge.id;
        }}
        onReconnect={(edge, connection) => connect(connection, edge.id)}
        onReconnectEnd={() => {
          reconnecting.current = undefined;
        }}
        onNodeClick={(_, node) => onSelect(node.id)}
        onPaneClick={() => onSelect(null)}
        onNodeDragStart={() => setDragging(true)}
        onNodeDragStop={() => setDragging(false)}
        deleteKeyCode={disabled ? null : ["Backspace", "Delete"]}
        multiSelectionKeyCode={null}
        ariaLabelConfig={{
          "node.a11yDescription.default": L.nodeKeyboard,
          "controls.ariaLabel": L.canvas,
          "controls.zoomIn.ariaLabel": L.zoomIn,
          "controls.zoomOut.ariaLabel": L.zoomOut,
          "controls.fitView.ariaLabel": L.fit,
          "handle.ariaLabel": L.inputPort,
          "node.a11yDescription.ariaLiveMessage": () => L.nodeMoved,
        }}
      >
        <ResponsiveViewport reveal={reveal} />
        <Background gap={20} size={1} />
        <Controls
          position={locale === "fa" ? "bottom-right" : "bottom-left"}
          showInteractive={false}
        />
      </ReactFlow>
    </section>
  );
}
