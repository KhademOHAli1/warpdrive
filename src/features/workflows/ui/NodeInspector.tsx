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

interface Props {
  definition: WorkflowDefinition;
  node: WorkflowNode;
  editable: boolean;
  onChange: (node: WorkflowNode) => void;
  onRemove: () => void;
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
    <QueriedInspector key={props.workflowId + ":" + props.node.type} {...props} />
  );
}
const hints: Partial<Record<WorkflowNode["type"], string>> = {
  "trigger.manual": "triggerHint",
  "record.read": "readHint",
  "activity.create": "taskHint",
};
function Inspector({
  definition,
  node,
  editable: onEdit,
  onChange,
  onRemove,
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
    <section className="flex flex-col" aria-label={t("configure")}>
      <div className="border-b p-5">
        <p className="text-xs font-medium text-muted-foreground">{t("configure")}</p>
        <h2 dir="auto" className="mt-2 break-words text-lg font-semibold">
          {displayNodeName(node, locale)}
        </h2>
      </div>
      <div className="space-y-5 p-5">
        <ConfigurationName
          node={node}
          editable={editable}
          onChange={onChange}
          nameInputRef={nameInputRef}
          spec={spec}
          validation={validation}
        />
        {hint !== undefined && <p className="text-sm text-muted-foreground">{t(hint, {})}</p>}
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
          <p className="text-xs text-muted-foreground">{t("configurationUnsupportedSetting")}</p>
        )}
      </div>
      {!node.type.startsWith("trigger.") && editable && (
        <div className="mt-auto border-t p-5">
          <Button variant="ghost" className="text-destructive" onClick={onRemove}>
            {t("remove")}
          </Button>
        </div>
      )}
    </section>
  );
}
