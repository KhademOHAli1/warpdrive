"use client";

import { Select } from "@/components/ui/Select";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { trpc } from "@/lib/trpc-client";
import type { ConfigurationValidation } from "../configurationTypes";
import { definitionSchema, type WorkflowNode } from "../schemas";
import {
  readWorkflowWebhookTrigger,
  workflowWebhookEndpointPath,
  workflowWebhookPublicationSchema,
  workflowWebhookTriggerConfigSchema,
} from "../workflowWebhookContract";
import { configurationIssueKeys } from "./configurationIssueMessage";
import styles from "./workflowInspector.module.css";

const publicationReadOptions = {
  staleTime: 0,
  refetchOnMount: "always",
  placeholderData: undefined,
  retry: false,
} as const;

function freshPublicationRead(read: {
  isSuccess: boolean;
  isFetchedAfterMount: boolean;
  isPlaceholderData: boolean;
  fetchStatus: string;
}): boolean {
  return (
    read.isSuccess &&
    read.isFetchedAfterMount &&
    !read.isPlaceholderData &&
    read.fetchStatus === "idle"
  );
}

function WebhookPublicationEndpoint({
  workflowId,
  nodeId,
  method,
}: {
  workflowId: string;
  nodeId: string;
  method: "GET" | "POST";
}) {
  const t = useAppTranslations("workflows");
  const workflow = trpc.workflows.get.useQuery({ id: workflowId }, publicationReadOptions);
  const active = workflow.data;
  const publishedNumber = active?.publishedNumber;
  const versionNumber =
    freshPublicationRead(workflow) &&
    active?.id === workflowId &&
    active.active &&
    active.archivedAt === null &&
    typeof publishedNumber === "number" &&
    Number.isSafeInteger(publishedNumber) &&
    publishedNumber > 0
      ? publishedNumber
      : null;
  const version = trpc.workflows.version.useQuery(
    { id: workflowId, versionNumber: versionNumber ?? 1 },
    { ...publicationReadOptions, enabled: versionNumber !== null },
  );
  const publication = version.data;
  if (
    versionNumber === null ||
    !freshPublicationRead(version) ||
    publication?.number !== versionNumber
  )
    return <p className={styles.hint}>{t("webhookPublishHint")}</p>;

  const definition = definitionSchema.safeParse(publication.definition);
  const trigger = definition.success ? readWorkflowWebhookTrigger(definition.data) : null;
  const route = workflowWebhookPublicationSchema.safeParse({
    workflowId,
    versionId: publication.id,
  });
  if (trigger?.id !== nodeId || trigger.config.httpMethod !== method || !route.success)
    return <p className={styles.hint}>{t("webhookPublishHint")}</p>;

  const endpoint = workflowWebhookEndpointPath(route.data);
  return (
    <div className={styles.field}>
      <p className={styles.label}>{t("webhookEndpoint")}</p>
      <code className="select-all break-all text-xs" dir="ltr">
        {endpoint}
      </code>
    </div>
  );
}

export function WebhookConfigurationFields({
  node,
  editable,
  onChange,
  workflowId,
  validation,
}: {
  node: WorkflowNode;
  editable: boolean;
  onChange: (node: WorkflowNode) => void;
  workflowId?: string;
  validation: ConfigurationValidation;
}) {
  const t = useAppTranslations("workflows");
  const method = workflowWebhookTriggerConfigSchema.shape.httpMethod.safeParse(
    node.config.httpMethod,
  );
  const config = workflowWebhookTriggerConfigSchema.safeParse(node.config);
  const workflow = workflowWebhookPublicationSchema.shape.workflowId.safeParse(workflowId);
  const issue = validation.issues.find(
    ({ path }) => path[0] === "httpMethod" || path[0] === "authentication",
  );

  return (
    <div className="space-y-4">
      <div className={styles.field}>
        <p className={styles.label}>{t("webhookMethod")}</p>
        <Select
          ariaLabel={t("webhookMethod")}
          value={method.success ? method.data : ""}
          disabled={!editable}
          options={[
            { value: "GET", label: "GET" },
            { value: "POST", label: "POST" },
          ]}
          onChange={(value) => {
            if (editable && (value === "GET" || value === "POST"))
              onChange({ ...node, config: { httpMethod: value, authentication: "HMAC_SHA256" } });
          }}
        />
        {method.success && (
          <p className={styles.hint}>
            {t(method.data === "GET" ? "webhookGetHint" : "webhookPostHint")}
          </p>
        )}
        {issue !== undefined && (
          <p className="text-xs text-destructive" role="alert">
            {t(configurationIssueKeys[issue.code])}
          </p>
        )}
      </div>
      <p className={styles.hint}>{t("webhookSigningHint")}</p>
      {workflow.success && config.success ? (
        <WebhookPublicationEndpoint
          workflowId={workflow.data}
          nodeId={node.id}
          method={config.data.httpMethod}
        />
      ) : (
        <p className={styles.hint}>{t("webhookPublishHint")}</p>
      )}
    </div>
  );
}
