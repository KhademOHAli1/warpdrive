"use client";
import type { Ref } from "react";
import { Button } from "@/components/ui/Button";
import { useAppTranslations, useLocale } from "@/features/i18n/LocaleProvider";
import { getConfigurationSpec } from "../configurationSpec";
import { validateNodeConfiguration } from "../configurationValidation";
import { displayNodeName } from "../nodeNames";
import type { WorkflowDefinition, WorkflowNode } from "../schemas";
import { ConfigurationMetadataStatus } from "./ConfigurationMetadataStatus";
import { ConfigurationName } from "./ConfigurationName";
import { ConfigurationNodeFields, RetainedConfigurationIssues } from "./ConfigurationNodeFields";
import {
  useWorkflowConfiguration,
  type WorkflowConfigurationRead,
} from "./useWorkflowConfiguration";
import { WorkflowReferenceIcon } from "./WorkflowReferenceIcon";
import styles from "./workflowInspector.module.css";
import {
  NODE_ICONS,
  workflowNodeCategory,
  workflowNodeStrokeWidth,
} from "./workflowNodePresentation";
import "./workflowTheme.css";

interface Props {
  definition: WorkflowDefinition;
  node: WorkflowNode;
  editable: boolean;
  onChange: (node: WorkflowNode) => void;
  onRemove: () => void;
  onClose?: () => void;
  nameInputRef?: Ref<HTMLInputElement>;
  workflowId?: string;
}
const noRead: WorkflowConfigurationRead = {
  metadata: { status: "incomplete" },
  busy: false,
  loadMore: undefined,
  retry: () => Promise.resolve(),
};
function QueriedInspector(props: Props) {
  const read = useWorkflowConfiguration(props.workflowId, props.node);
  return <Inspector {...props} read={read} />;
}
export function NodeInspector(props: Props) {
  return props.workflowId === undefined ? (
    <Inspector {...props} read={noRead} />
  ) : (
    <QueriedInspector key={`${props.workflowId}:${props.node.type}`} {...props} />
  );
}
const hints = {
  "trigger.manual": "manualLaunchHint",
  "trigger.record": undefined,
  "record.read": "readHint",
  "record.create": undefined,
  "record.update": undefined,
  "record.delete": undefined,
  "record.search": undefined,
  "record.upsert": undefined,
  "record.pick": undefined,
  "email.draft": undefined,
  "calendar.create": undefined,
  "human.form": undefined,
  "activity.create": "taskHint",
  condition: undefined,
  ifElse: undefined,
  iterator: undefined,
  filter: undefined,
  delay: undefined,
  notification: undefined,
} as const satisfies Record<WorkflowNode["type"], string | undefined>;
function Inspector({
  definition,
  node,
  editable: onEdit,
  onChange,
  onRemove,
  onClose,
  nameInputRef,
  workflowId,
  read,
}: Props & { read: WorkflowConfigurationRead }) {
  const t = useAppTranslations("workflows");
  const locale = useLocale();
  const editable = onEdit && read.authoring !== false && read.metadata.status !== "denied";
  const spec = getConfigurationSpec(node.type, node.version, read.metadata);
  const validation = validateNodeConfiguration(node, { definition, metadata: read.metadata });
  const hint = hints[node.type];
  return (
    <section className={`workflow-twenty-theme ${styles.panel}`} aria-label={t("configure")}>
      <header className={styles.header}>
        <span className={styles.icon} data-node-type={node.type}>
          <WorkflowReferenceIcon
            name={NODE_ICONS[node.type]}
            stroke={workflowNodeStrokeWidth(node.type)}
          />
        </span>
        <div className={styles.heading}>
          <h2 dir="auto" className={styles.title}>
            {displayNodeName(node, locale)}
          </h2>
          <span className={styles.category}>{t(workflowNodeCategory(node.type))}</span>
        </div>
        {onClose !== undefined && (
          <Button
            type="button"
            variant="outline"
            size="icon"
            static
            className={styles.close}
            aria-label={t("close")}
            onClick={onClose}
          >
            <WorkflowReferenceIcon name="x" />
          </Button>
        )}
      </header>
      <div className={styles.body}>
        <ConfigurationName
          node={node}
          editable={editable}
          onChange={onChange}
          nameInputRef={nameInputRef}
          spec={spec}
          validation={validation}
        />
        {hint !== undefined && <p className={styles.hint}>{t(hint)}</p>}
        <ConfigurationNodeFields
          definition={definition}
          node={node}
          editable={editable}
          onChange={onChange}
          workflowId={workflowId}
          spec={spec}
          validation={validation}
          metadata={read.metadata}
        />
        <RetainedConfigurationIssues spec={spec} validation={validation} />
        {node.type === "activity.create" && <ConfigurationMetadataStatus read={read} />}
        {spec?.supported === false && (
          <p className={styles.hint}>{t("configurationUnsupportedSetting")}</p>
        )}
      </div>
      {!node.type.startsWith("trigger.") && editable && (
        <div className={styles.footer}>
          <Button variant="ghost" static className={styles.remove} onClick={onRemove}>
            {t("remove")}
          </Button>
        </div>
      )}
    </section>
  );
}
