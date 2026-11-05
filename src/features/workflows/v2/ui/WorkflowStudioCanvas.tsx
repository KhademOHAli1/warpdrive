"use client";
import {
  Background,
  ConnectionLineType,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Connection,
  type Node,
  type NodeChange,
  type NodeProps,
  type EdgeChange,
} from "@xyflow/react";
import {
  CirclePlay,
  Database,
  GitBranch,
  Code2,
  Clock,
  Mail,
  Sparkles,
  ListFilter,
} from "lucide-react";
import { useState } from "react";
import { BlockCard } from "@/features/blocks/ui/BlockCard";
import { useSharedBlocksMessages } from "@/features/blocks/sharedBlocksMessages";
import type {
  ActionBlockKind,
  WorkflowV2Definition,
  WorkflowV2Node,
} from "@/features/blocks/contracts";
import { ResponsiveViewport } from "@/features/workflows/ui/ResponsiveViewport";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import {
  arrangeStudio,
  asArray,
  asObject,
  connectStudioNodes,
  portsForNode,
  removeStudioNode,
  textValue,
} from "./studioModel";
import "@xyflow/react/dist/style.css";
import "@/features/workflows/ui/workflowCanvas.css";

export const studioIcons = {
  $trigger: CirclePlay,
  CREATE_RECORD: Database,
  UPDATE_RECORD: Database,
  DELETE_RECORD: Database,
  UPSERT_RECORD: Database,
  FIND_RECORDS: Database,
  PICK_RECORD: Database,
  FORM: ListFilter,
  FILTER: ListFilter,
  ITERATOR: ListFilter,
  IF_ELSE: GitBranch,
  DELAY: Clock,
  WAIT_FOR_EVENT: Clock,
  CODE: Code2,
  LOGIC_FUNCTION: Code2,
  HTTP_REQUEST: Code2,
  AI_AGENT: Sparkles,
  CLASSIFY: Sparkles,
  SEND_EMAIL: Mail,
  DRAFT_EMAIL: Mail,
  SEND_CHAT_MESSAGE: Mail,
  CREATE_CALENDAR_EVENT: Mail,
} as const;
export function studioCategory(type: ActionBlockKind) {
  if (
    [
      "CREATE_RECORD",
      "UPDATE_RECORD",
      "DELETE_RECORD",
      "UPSERT_RECORD",
      "FIND_RECORDS",
      "PICK_RECORD",
    ].includes(type)
  )
    return "data";
  if (["AI_AGENT", "CLASSIFY"].includes(type)) return "ai";
  if (["FILTER", "ITERATOR", "IF_ELSE", "DELAY", "WAIT_FOR_EVENT"].includes(type)) return "flow";
  if (["FORM", "SEND_CHAT_MESSAGE"].includes(type)) return "human";
  return "core";
}
type CanvasData = { node?: WorkflowV2Node; trigger: string; invalid: boolean };
type StudioNode = Node<CanvasData, "studio">;
function StudioNodeView({ data, selected, isConnectable }: NodeProps<StudioNode>) {
  const L = useSharedBlocksMessages();
  const { locale } = useLocalePreferences();
  const node = data.node;
  const Icon = studioIcons[node?.type ?? "$trigger"];
  const ports = node === undefined ? ["next"] : portsForNode(node);
  const branches = asArray(node?.config.branches).map(asObject);
  return (
    <div dir={locale === "fa" ? "rtl" : "ltr"}>
      <BlockCard
        selected={selected}
        invalid={data.invalid}
        icon={<Icon className="size-3.5" aria-hidden />}
        label={node === undefined ? L.trigger : (L.blocks[node.type] ?? node.type)}
        title={node?.name ?? data.trigger}
        summary={node === undefined ? undefined : textValue(node.config.objectName) || undefined}
      >
        {node !== undefined && (
          <Handle
            id="in"
            type="target"
            position={Position.Top}
            isConnectable={isConnectable}
            aria-label={L.inputs}
          />
        )}
        {ports.map((port, index) => (
          <Handle
            key={port}
            id={port}
            type="source"
            position={Position.Bottom}
            style={{ left: `${((index + 1) * 100) / (ports.length + 1)}%` }}
            isConnectable={isConnectable}
            aria-label={
              port === "loop"
                ? L.loop
                : port === "done"
                  ? L.done
                  : port === "next"
                    ? L.next
                    : textValue(branches.find((branch) => branch.id === port)?.label) ||
                      (branches.find((branch) => branch.id === port)?.condition === undefined
                        ? L.elseRoute
                        : `${L.fields.routeName} ${index + 1}`)
            }
          />
        ))}
      </BlockCard>
      {ports.length > 1 && (
        <div className="mt-1 flex justify-around gap-1 text-[9px] text-muted-foreground">
          {ports.map((port, index) => (
            <span key={port}>
              {port === "loop"
                ? L.loop
                : port === "done"
                  ? L.done
                  : textValue(branches.find((branch) => branch.id === port)?.label) ||
                    (branches.find((branch) => branch.id === port)?.condition === undefined
                      ? L.elseRoute
                      : `${L.fields.routeName} ${index + 1}`)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
const nodeTypes = { studio: StudioNodeView };
export function WorkflowStudioCanvas({
  definition,
  selected,
  disabled,
  onSelect,
  onChange,
  reveal,
  layoutRevision,
}: {
  definition: WorkflowV2Definition;
  selected: string;
  disabled: boolean;
  onSelect: (id: string) => void;
  onChange: (definition: WorkflowV2Definition) => void;
  reveal?: { id: string; nonce: number };
  layoutRevision: number;
}) {
  const L = useSharedBlocksMessages();
  const [sizes, setSizes] = useState(new Map<string, { width: number; height: number }>());
  const [positions, setPositions] = useState(new Map<string, { x: number; y: number }>());
  const layout = definition.layout ?? arrangeStudio(definition).layout ?? {};
  const triggerKey =
    definition.trigger.type === "record.created_or_updated"
      ? "upserted"
      : definition.trigger.type.startsWith("record.")
        ? definition.trigger.type.slice(7)
        : definition.trigger.type === "schedule"
          ? "cron"
          : definition.trigger.type;
  const specs = [
    { id: "$trigger", node: undefined },
    ...definition.nodes.map((node) => ({ id: node.id, node })),
  ];
  const nodes: StudioNode[] = specs.map((spec) => ({
    id: spec.id,
    type: "studio",
    position: positions.get(spec.id) ?? layout[spec.id] ?? { x: 0, y: 0 },
    measured: sizes.get(spec.id),
    data: { node: spec.node, trigger: L.triggers[triggerKey] ?? L.trigger, invalid: false },
    selected: selected === spec.id,
    deletable: !disabled && spec.id !== "$trigger",
    ariaLabel: spec.node?.name ?? L.trigger,
  }));
  const edges = [
    ...definition.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourcePort,
      targetHandle: "in",
      type: "smoothstep",
    })),
    ...definition.entryNodeIds.map((id) => ({
      id: `$trigger:${id}`,
      source: "$trigger",
      target: id,
      sourceHandle: "next",
      targetHandle: "in",
      type: "smoothstep",
    })),
  ];
  function changes(values: NodeChange<StudioNode>[]) {
    let next = definition;
    for (const change of values) {
      if (change.type === "dimensions" && change.dimensions !== undefined) {
        const dimensions = change.dimensions;
        setSizes((current) => new Map(current).set(change.id, dimensions));
      }
      if (disabled) continue;
      if (change.type === "remove") next = removeStudioNode(next, change.id);
      if (change.type === "position" && change.position !== undefined) {
        const position = change.position;
        setPositions((current) => {
          const result = new Map(current);
          if (change.dragging === true) result.set(change.id, position);
          else result.delete(change.id);
          return result;
        });
        if (change.dragging !== true)
          next = { ...next, layout: { ...(next.layout ?? layout), [change.id]: position } };
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
      aria-label={L.title}
      dir="ltr"
      className="workflow-canvas min-h-[340px] min-w-0 bg-muted/15"
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
        onNodesChange={changes}
        onEdgesChange={edgeChanges}
        onNodeClick={(_, node) => onSelect(node.id)}
        onPaneClick={() => onSelect("$trigger")}
        onConnect={connect}
        isValidConnection={(connection) =>
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
        connectionLineType={ConnectionLineType.SmoothStep}
      >
        <ResponsiveViewport reveal={reveal} />
        <Background gap={20} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </section>
  );
}
