"use client";

import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import { type ReactNode, useId } from "react";
import { Button } from "@/components/ui/Button";
import { useAppTranslations, useLocale } from "@/features/i18n/LocaleProvider";
import { directionForLocale } from "@/features/i18n/registry";
import { useFormatters } from "@/lib/useFormatters";
import { cn } from "@/lib/utils";
import { portsFor } from "../graphEditor";
import { ifElseBranchOffset } from "../nodeLayout";
import { displayNodeName, nodeLabelKeys } from "../nodeNames";
import type { WorkflowDefinition, WorkflowNode } from "../schemas";
import { useConditionPortLabel } from "./conditionPortLabel";
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
function FreeBranchOutput({
  offset,
  startX,
  height,
  label,
  children,
}: {
  offset: { x: number; y: number };
  startX: number;
  height: number;
  label: string;
  children: ReactNode;
}) {
  const endY = offset.y - height / 2 - 12;
  const bend = endY / 2;
  return (
    <>
      {/* eslint-disable-next-line no-restricted-syntax -- This path draws the actual unconnected branch using measured node geometry. */}
      <svg
        width={1}
        height={1}
        className={styles.branchConnector}
        aria-hidden="true"
        focusable="false"
      >
        <path
          d={`M${startX} 0 C${startX} ${bend} ${offset.x} ${bend} ${offset.x} ${endY}`}
          fill="none"
          stroke="currentColor"
          strokeDasharray="3 3"
        />
      </svg>
      <div
        className={cn("nodrag nopan", styles.freeBranch)}
        style={{ left: `calc(50% + ${offset.x}px)`, top: `calc(50% + ${offset.y}px)` }}
      >
        <span className={cn(styles.branchLabel, styles.freeBranchLabel)}>{label}</span>
        {children}
      </div>
    </>
  );
}

export function WorkflowNodeCard({
  data,
  selected,
  isConnectable,
  width,
  height,
}: NodeProps<CanvasNode>) {
  const t = useAppTranslations("workflows");
  const locale = useLocale();
  const fmt = useFormatters();
  const portLabel = useConditionPortLabel();
  const { node } = data;
  const descriptionId = useId();
  const ports = portsFor(node);
  return (
    <section
      dir={directionForLocale(locale)}
      aria-describedby={descriptionId}
      aria-invalid={data.invalid || undefined}
      className={cn("workflow-twenty-theme", styles.node)}
      style={node.type === "ifElse" ? { minWidth: (ports.length + 1) * 20 } : undefined}
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
        {ports.length > 1 && ports.map((port) => <span key={port}>{portLabel(port, node)}</span>)}
      </div>
      {ports.map((port, index) => {
        const branch = ifElseBranchOffset(node, port);
        const label = portLabel(port, node);
        const fraction = (index + 1) / (ports.length + 1);
        const horizontal = port === "true";
        const connector = horizontal
          ? { width: 56, height: 2, path: "M0 1H28H56" }
          : { width: 2, height: 56, path: "M1 0V28V56" };
        const addButton =
          data.onAdd !== undefined && data.outputs?.includes(port) !== true ? (
            <Button
              variant="ghost"
              size="icon"
              static
              dir={directionForLocale(locale)}
              className={styles.addButton}
              aria-label={t("addAfter", { name: displayNodeName(node, locale), port: label })}
              onClick={(event) => {
                event.stopPropagation();
                data.onAdd?.({ from: node.id, port });
              }}
            >
              <WorkflowReferenceIcon name="plus" />
            </Button>
          ) : null;
        return (
          <div key={port}>
            {addButton !== null &&
              (branch !== null ? (
                <FreeBranchOutput
                  offset={branch}
                  startX={(width ?? 0) * (fraction - 0.5)}
                  height={height ?? 50}
                  label={label}
                >
                  {addButton}
                </FreeBranchOutput>
              ) : (
                <div
                  dir="ltr"
                  className={cn(
                    "nodrag nopan",
                    styles.freeOutput,
                    horizontal && styles.freeOutputRight,
                  )}
                >
                  <div className={styles.connector} aria-hidden="true">
                    {/* eslint-disable-next-line no-restricted-syntax -- The dashed path connects this graph port to the add-step control. */}
                    <svg
                      width={connector.width}
                      height={connector.height}
                      viewBox={`0 0 ${connector.width} ${connector.height}`}
                      fill="none"
                      aria-hidden="true"
                      focusable="false"
                    >
                      <path d={connector.path} stroke="currentColor" strokeDasharray="3 3" />
                    </svg>
                  </div>
                  {ports.length > 1 && (
                    <span className={styles.branchLabel} dir={directionForLocale(locale)}>
                      {label}
                    </span>
                  )}
                  {addButton}
                </div>
              ))}
            <Handle
              id={port}
              type="source"
              position={horizontal ? Position.Right : Position.Bottom}
              isConnectable={isConnectable}
              aria-label={label}
              className={branch === null ? undefined : styles.branchHandle}
              style={branch === null ? undefined : { left: `${fraction * 100}%` }}
            />
          </div>
        );
      })}
    </section>
  );
}
