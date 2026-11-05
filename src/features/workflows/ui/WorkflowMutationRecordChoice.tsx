"use client";

import { z } from "zod";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { trpc } from "@/lib/trpc-client";
import { draftBindingSchema, type WorkflowNode } from "../schemas";
import type { RecordMutationEntity } from "../workflowRecordMutationContract";
import { useWorkflowConfigurationReferences } from "./useWorkflowConfigurationReferences";

interface Props {
  workflowId: string;
  type: WorkflowNode["type"];
  entity: RecordMutationEntity;
  value: unknown;
  editable: boolean;
  label: string;
  onChange: (id: string) => void;
}

function selectedRecordId(value: unknown): string | undefined {
  const binding = draftBindingSchema.safeParse(value);
  if (!binding.success || binding.data.kind !== "value") return undefined;
  const id = z.uuid().safeParse(binding.data.value);
  return id.success ? id.data : undefined;
}

function ReadonlyRecordChoice({
  workflowId,
  type,
  entity,
  value,
  label,
}: Omit<Props, "editable" | "onChange">) {
  const t = useAppTranslations("workflows");
  const id = selectedRecordId(value);
  const query = trpc.workflows.configurationReferences.useQuery(
    {
      workflowId,
      type,
      version: 1,
      field: { kind: "record", entity },
      mode: "selected",
      ids: id === undefined ? [] : [id],
    },
    { enabled: id !== undefined, refetchOnMount: "always", staleTime: 0, retry: false },
  );
  const data = query.data;
  const visible =
    id !== undefined &&
    !query.isLoading &&
    !query.isFetching &&
    !query.isError &&
    data?.state === "page" &&
    data.mode === "selected" &&
    data.workflowId === workflowId &&
    data.type === type &&
    data.field.kind === "record" &&
    data.field.entity === entity
      ? data.items.find((item) => item.id === id)
      : undefined;
  return (
    <Select
      ariaLabel={label}
      value={visible?.id ?? ""}
      disabled
      placeholder={t(id === undefined ? "chooseValue" : "unavailableValue")}
      options={visible === undefined ? [] : [{ value: visible.id, label: visible.label }]}
      onChange={() => {}}
    />
  );
}

function EditableRecordChoice({
  workflowId,
  type,
  entity,
  value,
  label,
  onChange,
}: Omit<Props, "editable">) {
  const t = useAppTranslations("workflows");
  const selectedId = selectedRecordId(value);
  const read = useWorkflowConfigurationReferences({
    workflowId,
    type,
    selector: { kind: "record", entity },
    selectedId,
    enabled: true,
  });
  return (
    <div className="space-y-2">
      <Input
        aria-label={`${label} · ${t("customReferenceSearch")}`}
        value={read.search}
        maxLength={200}
        disabled={read.status === "denied"}
        onChange={(event) => read.onSearch(event.target.value)}
      />
      <Select
        ariaLabel={`${label} · ${t("configurationSelectRecord")}`}
        value={selectedId ?? ""}
        disabled={read.status !== "ready"}
        placeholder={t(read.unavailable ? "unavailableValue" : "chooseValue")}
        options={read.options.map(({ id, label }) => ({ value: id, label }))}
        onChange={(id) => {
          if (read.status === "ready" && read.options.some((option) => option.id === id))
            onChange(id);
        }}
      />
      {read.nextCursor !== null && (
        <Button
          variant="outline"
          size="sm"
          disabled={read.loadingMore === true || read.status !== "ready"}
          onClick={() => void read.onMore?.()}
        >
          {t("customReferenceMore")}
        </Button>
      )}
      {read.status === "error" && (
        <div className="space-y-2 text-xs text-destructive" role="alert">
          <p>{t("configurationLookupError")}</p>
          <Button variant="outline" size="sm" onClick={() => void read.retry()}>
            {t("retry")}
          </Button>
        </div>
      )}
      {read.status === "denied" && (
        <p className="text-xs text-destructive">{t("customReferenceDenied")}</p>
      )}
      {read.stale && <p className="text-xs text-destructive">{t("configurationMetadataStale")}</p>}
    </div>
  );
}

export function WorkflowMutationRecordChoice({ editable, ...props }: Props) {
  return editable ? <EditableRecordChoice {...props} /> : <ReadonlyRecordChoice {...props} />;
}
