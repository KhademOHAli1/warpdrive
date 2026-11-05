"use client";

import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import { useId } from "react";
import { Button } from "@/components/ui/Button";
import { useAppTranslations, useLocale } from "@/features/i18n/LocaleProvider";
import { directionForLocale } from "@/features/i18n/registry";
import { useFormatters } from "@/lib/useFormatters";
import { cn } from "@/lib/utils";
import { portsFor } from "../graphEditor";
import { displayNodeName, nodeLabelKeys } from "../nodeNames";
import type { WorkflowDefinition, WorkflowNode } from "../schemas";
import { conditionPortLabel } from "./conditionPortLabel";
import { NodeSummary } from "./NodeSummary";
import type { AddFromOutput } from "./useConnectionGestures";
import styles from "./WorkflowNodeCard.module.css";
import { WorkflowNodeOptions } from "./WorkflowNodeOptions";
import { WorkflowReferenceIcon } from "./WorkflowReferenceIcon";
import {
  NODE_ICONS,
  workflowNodeCategory,
  workflowNodeStrokeWidth,
} from "./workflowNodePresentation";
import "./workflowTheme.css";

export type CanvasNode = Node<
  {
    node: WorkflowNode;
    definition?: WorkflowDefinition;
    invalid: boolean;
    index: number;
    completed?: boolean;
    outputs?: string[];
    onAdd?: AddFromOutput;
    onConfigure?: () => void;
    onChangeType?: () => void;
    onDuplicate?: () => void;
    onRemove?: () => void;
  },
  "workflow"
>;
export function WorkflowNodeCard({ data, selected, isConnectable }: NodeProps<CanvasNode>) {
  const t = useAppTranslations("workflows");
  const locale = useLocale();
  const fmt = useFormatters();
  const { node } = data;
  const descriptionId = useId();
  const ports = portsFor(node);
  return (
    <section
      dir={directionForLocale(locale)}
      aria-describedby={descriptionId}
      aria-invalid={data.invalid || undefined}
      className={cn("workflow-twenty-theme", styles.node)}
    >
      <div
        className={cn(
          styles.card,
          selected && styles.selected,
          isConnectable && styles.connectable,
          data.completed === true && styles.completed,
          data.invalid && styles.invalid,
        )}
      >
        {!node.type.startsWith("trigger.") && (
          <Handle
            id="in"
            type="target"
            position={Position.Top}
            isConnectable={isConnectable}
            aria-label={t("inputPort")}
          />
        )}
        <span className={styles.icon} data-node-type={node.type}>
          <WorkflowReferenceIcon
            name={NODE_ICONS[node.type]}
            stroke={workflowNodeStrokeWidth(node.type)}
          />
        </span>
        <div className={styles.rightPart}>
          <div className={styles.labelRow}>
            <span className={styles.label}>{t(workflowNodeCategory(node.type))}</span>
          </div>
          <div dir="auto" className={styles.title}>
            {displayNodeName(node, locale)}
          </div>
        </div>
      </div>
      {selected && (
        <WorkflowNodeOptions
          trigger={node.type.startsWith("trigger.")}
          onChangeType={data.onChangeType}
          onDuplicate={data.onDuplicate}
          onRemove={data.onRemove}
        />
      )}
      <div id={descriptionId} className={styles.description}>
        <span>
          {t(nodeLabelKeys[node.type])} · {fmt.number(data.index + 1)}
        </span>
        <NodeSummary node={node} definition={data.definition} />
        {data.invalid && <span>{t("invalid")}</span>}
        {data.completed === true && <span>{t("stepCompleted")}</span>}
        {ports.length > 1 &&
          ports.map((port) => <span key={port}>{t(conditionPortLabel(port))}</span>)}
      </div>
      {ports.map((port) => (
        <div key={port}>
          {data.onAdd !== undefined && data.outputs?.includes(port) !== true && (
            <div
              dir="ltr"
              className={cn(
                "nodrag nopan",
                styles.freeOutput,
                port === "true" && styles.freeOutputRight,
              )}
            >
              <div className={styles.connector} aria-hidden="true">
                <svg
                  width={port === "true" ? "56" : "2"}
                  height={port === "true" ? "2" : "56"}
                  viewBox={port === "true" ? "0 0 56 2" : "0 0 2 56"}
                  fill="none"
                  aria-hidden="true"
                  focusable="false"
                >
                  <path
                    d={port === "true" ? "M0 1H28H56" : "M1 0V28V56"}
                    stroke="currentColor"
                    strokeDasharray="3 3"
                  />
                </svg>
              </div>
              {ports.length > 1 && (
                <span className={styles.branchLabel} dir={directionForLocale(locale)}>
                  {t(conditionPortLabel(port))}
                </span>
              )}
              <Button
                variant="ghost"
                size="icon"
                static
                dir={directionForLocale(locale)}
                className={styles.addButton}
                aria-label={t("addAfter", {
                  name: displayNodeName(node, locale),
                  port: t(conditionPortLabel(port)),
                })}
                onClick={(event) => {
                  event.stopPropagation();
                  data.onAdd?.({ from: node.id, port });
                }}
              >
                <WorkflowReferenceIcon name="plus" />
              </Button>
            </div>
          )}
          <Handle
            id={port}
            type="source"
            position={port === "true" ? Position.Right : Position.Bottom}
            isConnectable={isConnectable}
            aria-label={t(conditionPortLabel(port))}
          />
        </div>
      ))}
    </section>
  );
}
