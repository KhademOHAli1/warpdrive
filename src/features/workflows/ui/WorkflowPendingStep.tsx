"use client";

import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import { Button } from "@/components/ui/Button";
import { useAppTranslations, useLocale } from "@/features/i18n/LocaleProvider";
import { directionForLocale } from "@/features/i18n/registry";
import { cn } from "@/lib/utils";
import styles from "./WorkflowNodeCard.module.css";
import { WorkflowReferenceIcon } from "./WorkflowReferenceIcon";

export type PendingCanvasNode = Node<{ focusPicker: () => void }, "pendingWorkflowStep">;

export function WorkflowPendingStep({ data }: NodeProps<PendingCanvasNode>) {
  const t = useAppTranslations("workflows");
  const locale = useLocale();
  return (
    <section dir={directionForLocale(locale)} className={cn("workflow-twenty-theme", styles.node)}>
      <div className={cn(styles.card, styles.pendingCard)}>
        <Handle id="in" type="target" position={Position.Top} isConnectable={false} />
        <span className={styles.icon} aria-hidden="true" />
        <div className={styles.rightPart}>
          <div className={styles.labelRow}>
            <span className={styles.label}>{t("nodeCategoryAction")}</span>
          </div>
          <div className={styles.title}>{t("addAnAction")}</div>
        </div>
      </div>
      <div dir="ltr" className={cn("nodrag nopan", styles.freeOutput)}>
        <div className={styles.connector} aria-hidden="true">
          <svg
            width="2"
            height="56"
            viewBox="0 0 2 56"
            fill="none"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M1 0V28V56" stroke="currentColor" strokeDasharray="3 3" />
          </svg>
        </div>
        <Button
          variant="ghost"
          size="icon"
          static
          className={styles.addButton}
          aria-label={t("selectAction")}
          onClick={(event) => {
            event.stopPropagation();
            data.focusPicker();
          }}
        >
          <WorkflowReferenceIcon name="plus" />
        </Button>
      </div>
    </section>
  );
}
