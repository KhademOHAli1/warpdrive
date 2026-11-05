"use client";

import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import { Button } from "@/components/ui/Button";
import type { TriggerBlockKind, WorkflowV2Node } from "@/features/blocks/contracts";
import { useSharedBlocksMessages } from "@/features/blocks/sharedBlocksMessages";
import { useAppTranslations, useLocale } from "@/features/i18n/LocaleProvider";
import { directionForLocale } from "@/features/i18n/registry";
import styles from "@/features/workflows/ui/WorkflowNodeCard.module.css";
import { WorkflowNodeOptions } from "@/features/workflows/ui/WorkflowNodeOptions";
import { WorkflowReferenceIcon } from "@/features/workflows/ui/WorkflowReferenceIcon";
import { cn } from "@/lib/utils";
import diagram from "./studioDiagram.module.css";
import { asArray, asObject, portsForNode, textValue } from "./studioModel";
import { studioActions, studioTriggers } from "./studioPresentation";

export type StudioNode = Node<
  {
    node?: WorkflowV2Node;
    trigger: TriggerBlockKind;
    connectedPorts: ReadonlySet<string>;
    onAdd?: (port: string) => void;
    onRemove?: () => void;
  },
  "studio"
>;

type Messages = ReturnType<typeof useSharedBlocksMessages>;
export function studioPortLabel(L: Messages, node: WorkflowV2Node | undefined, port: string) {
  if (port === "loop") return L.loop;
  if (port === "done") return L.done;
  if (port === "next") return L.next;
  const branches = asArray(node?.config.branches).map(asObject);
  const index = branches.findIndex((branch) => branch.id === port);
  const branch = branches[index];
  return (
    textValue(branch?.label) ||
    (branch?.condition === undefined ? L.elseRoute : `${L.fields.routeName} ${index + 1}`)
  );
}

function StudioAddOutput({
  port,
  title,
  label,
  offset,
  onAdd,
}: {
  port: string;
  title: string;
  label: string;
  offset: number;
  onAdd: () => void;
}) {
  const t = useAppTranslations("workflows");
  const horizontal = port === "loop";
  const geometry = horizontal
    ? { width: 56, height: 2, path: "M0 1H56" }
    : {
        width: 2,
        height: 56,
        path: "M1 0V56",
      };
  return (
    <div
      dir="ltr"
      className={cn("nodrag nopan", diagram.branchAdd)}
      data-loop={horizontal}
      style={horizontal ? undefined : { left: `${offset}%` }}
    >
      <span className={styles.connector} aria-hidden="true">
        {/* eslint-disable-next-line no-restricted-syntax -- SVG draws the connection to the unlinked output's add button. */}
        <svg width={geometry.width} height={geometry.height} aria-hidden="true" focusable="false">
          <path d={geometry.path} fill="none" stroke="currentColor" strokeDasharray="3 3" />
        </svg>
      </span>
      {port !== "next" && <span className={cn(styles.branchLabel, diagram.branch)}>{label}</span>}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        static
        className={styles.addButton}
        aria-label={t("addAfter", { name: title, port: label })}
        onClick={(event) => {
          event.stopPropagation();
          onAdd();
        }}
      >
        <WorkflowReferenceIcon name="plus" />
      </Button>
    </div>
  );
}

export function StudioDiagramNode({ data, selected, isConnectable }: NodeProps<StudioNode>) {
  const L = useSharedBlocksMessages();
  const locale = useLocale();
  const { node, onAdd } = data;
  const trigger = studioTriggers[data.trigger];
  const appearance = node === undefined ? undefined : studioActions[node.type];
  const category =
    appearance?.group ?? (data.trigger.startsWith("record.") ? "record-trigger" : "trigger");
  const title = node?.name ?? L.triggers[trigger.key] ?? L.trigger;
  const ports = node === undefined ? ["next"] : portsForNode(node);
  const bottomPorts = ports.filter((port) => port !== "loop");
  return (
    <div dir={directionForLocale(locale)} className={styles.node}>
      <div
        className={cn(
          styles.card,
          selected && styles.selected,
          isConnectable && styles.connectable,
        )}
        style={{ minWidth: Math.max(44, (bottomPorts.length + 1) * 32) }}
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
        <span className={cn(styles.icon, diagram.cardIcon)} data-studio-category={category}>
          <WorkflowReferenceIcon
            name={appearance?.icon ?? trigger.icon}
            stroke={appearance?.stroke}
          />
        </span>
        <div className={styles.rightPart}>
          <div className={styles.labelRow}>
            <span className={styles.label}>
              {appearance === undefined ? L.trigger : L.groups[appearance.group]}
            </span>
          </div>
          <div dir="auto" className={styles.title}>
            {title}
          </div>
        </div>
        {ports.map((port) => {
          const offset = ((bottomPorts.indexOf(port) + 1) * 100) / (bottomPorts.length + 1);
          const label = studioPortLabel(L, node, port);
          const horizontal = port === "loop";
          return (
            <Handle
              key={port}
              id={port}
              type="source"
              position={horizontal ? Position.Right : Position.Bottom}
              style={horizontal ? undefined : { left: `${offset}%` }}
              isConnectable={isConnectable}
              aria-label={label}
            />
          );
        })}
      </div>
      {selected && <WorkflowNodeOptions trigger={node === undefined} onRemove={data.onRemove} />}
      {onAdd !== undefined &&
        ports
          .filter((port) => !data.connectedPorts.has(port))
          .map((port) => (
            <StudioAddOutput
              key={port}
              port={port}
              title={title}
              label={studioPortLabel(L, node, port)}
              offset={((bottomPorts.indexOf(port) + 1) * 100) / (bottomPorts.length + 1)}
              onAdd={() => onAdd(port)}
            />
          ))}
    </div>
  );
}
