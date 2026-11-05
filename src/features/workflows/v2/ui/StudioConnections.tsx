"use client";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { BlockField } from "@/features/blocks/ui/BlockField";
import { useSharedBlocksMessages } from "@/features/blocks/sharedBlocksMessages";
import type { WorkflowV2Definition, WorkflowV2Node } from "@/features/blocks/contracts";
import { asArray, asObject, connectStudioNodes, portsForNode, textValue } from "./studioModel";
export function StudioConnections({
  definition,
  node,
  disabled,
  onChange,
  onAdd,
}: {
  definition: WorkflowV2Definition;
  node?: WorkflowV2Node;
  disabled: boolean;
  onChange: (definition: WorkflowV2Definition) => void;
  onAdd: (port: string) => void;
}) {
  const L = useSharedBlocksMessages();
  const source = node?.id ?? "$trigger";
  const ports = node === undefined ? ["next"] : portsForNode(node);
  const branches = asArray(node?.config.branches).map(asObject);
  function label(port: string) {
    return port === "next"
      ? L.next
      : port === "loop"
        ? L.loop
        : port === "done"
          ? L.done
          : textValue(branches.find((branch) => branch.id === port)?.label) ||
            (branches.find((branch) => branch.id === port)?.condition === undefined
              ? L.elseRoute
              : (L.fields.routeName ?? ""));
  }
  return (
    <div className="space-y-4 border-t p-4">
      <h3 className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {L.next}
      </h3>
      {ports.map((port) => {
        const targets =
          source === "$trigger"
            ? definition.entryNodeIds
            : definition.edges
                .filter((edge) => edge.source === source && edge.sourcePort === port)
                .map((edge) => edge.target);
        const options = definition.nodes
          .filter(
            (target) =>
              !targets.includes(target.id) &&
              connectStudioNodes(definition, source, target.id, port) !== null,
          )
          .map((target) => ({ value: target.id, label: target.name }));
        return (
          <BlockField key={port} label={label(port)}>
            {targets.map((target) => (
              <div key={target} className="flex items-center justify-between gap-1 text-xs">
                <span className="min-w-0 truncate" dir="auto">
                  {definition.nodes.find((item) => item.id === target)?.name}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={disabled}
                  aria-label={`${L.remove}: ${definition.nodes.find((item) => item.id === target)?.name ?? ""}`}
                  onClick={() =>
                    onChange(
                      source === "$trigger"
                        ? {
                            ...definition,
                            entryNodeIds: definition.entryNodeIds.filter((id) => id !== target),
                          }
                        : {
                            ...definition,
                            edges: definition.edges.filter(
                              (edge) =>
                                !(
                                  edge.source === source &&
                                  edge.target === target &&
                                  edge.sourcePort === port
                                ),
                            ),
                          },
                    )
                  }
                >
                  ×
                </Button>
              </div>
            ))}
            <Select
              ariaLabel={`${L.next}: ${label(port)}`}
              value=""
              disabled={disabled}
              options={[{ value: "", label: L.selectStep }, ...options]}
              onChange={(target) => {
                if (target === "") return;
                const next = connectStudioNodes(definition, source, target, port);
                if (next !== null) onChange(next);
              }}
            />
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-1 text-xs"
              disabled={disabled}
              onClick={() => onAdd(port)}
            >
              {L.add}
            </Button>
          </BlockField>
        );
      })}
    </div>
  );
}
