"use client";

import {
  Background,
  Controls,
  Handle,
  MarkerType,
  type Node,
  type NodeProps,
  Panel,
  Position,
  ReactFlow,
} from "@xyflow/react";
import { CirclePlay, Database, ListTodo, Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import type { WorkflowDefinition, WorkflowNode } from "../schemas";
import "@xyflow/react/dist/style.css";
import "./workflowCanvas.css";

type FlowNode = Node<{ node: WorkflowNode; index: number }, "workflow">;
function WorkflowCard({ data, selected }: NodeProps<FlowNode>) {
  const t = useAppTranslations("workflows");
  const type = data.node.type;
  const Icon =
    type === "trigger.manual" ? CirclePlay : type === "record.read" ? Database : ListTodo;
  const label =
    type === "trigger.manual" ? t("start") : type === "record.read" ? t("read") : t("task");
  return (
    <section
      className={`w-72 rounded-lg border bg-card px-5 py-4 text-start shadow-sm ${selected ? "border-primary ring-2 ring-primary/15" : "border-border"}`}
    >
      {type !== "trigger.manual" && (
        <Handle type="target" position={Position.Top} isConnectable={false} />
      )}
      <div className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Icon className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="mt-1 truncate text-sm font-semibold">{data.node.name}</p>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
    </section>
  );
}
const nodeTypes = { workflow: WorkflowCard };

export function WorkflowCanvas({
  definition,
  selected,
  onSelect,
  onAdd,
  editable,
}: {
  definition: WorkflowDefinition;
  selected: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
  editable: boolean;
}) {
  const t = useAppTranslations("workflows");
  const nodes: FlowNode[] = definition.nodes.map((node, index) => ({
    id: node.id,
    type: "workflow",
    data: { node, index },
    position: { x: 0, y: index * 155 },
    selected: selected === node.id,
    ariaLabel: node.name,
  }));
  const edges = definition.edges.map((edge) => ({
    id: `${edge.from}-${edge.port}-${edge.to}`,
    source: edge.from,
    target: edge.to,
    type: "smoothstep",
    markerEnd: { type: MarkerType.ArrowClosed },
    ariaLabel: t("edgeDescription"),
  }));
  return (
    <section
      className="workflow-canvas relative h-[540px] min-w-0 bg-muted/25 lg:h-[650px]"
      aria-label={t("canvas")}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.25 }}
        nodesDraggable={false}
        nodesConnectable={false}
        deleteKeyCode={null}
        nodesFocusable={false}
        edgesFocusable={false}
        disableKeyboardA11y
        onNodeClick={(_, node) => onSelect(node.id)}
        ariaLabelConfig={{
          "controls.zoomIn.ariaLabel": t("zoomIn"),
          "controls.zoomOut.ariaLabel": t("zoomOut"),
          "controls.fitView.ariaLabel": t("fitView"),
        }}
      >
        <Background gap={22} size={1} />
        <Controls showInteractive={false} />
        {editable && (
          <Panel position="bottom-center">
            <Button variant="outline" onClick={onAdd} disabled={definition.nodes.length >= 100}>
              <Plus className="size-4" />
              {t("addTask")}
            </Button>
          </Panel>
        )}
      </ReactFlow>
    </section>
  );
}
