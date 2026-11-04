"use client";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import type { WorkflowNode } from "../schemas";
import { useWorkflowConfigurationReferences } from "./useWorkflowConfigurationReferences";
export function WorkflowRecordChoice({
  workflowId,
  type,
  field,
  value,
  editable,
  onChange,
  label,
}: {
  workflowId: string;
  type: WorkflowNode["type"];
  field: "recordId" | "dealId";
  value: unknown;
  editable: boolean;
  onChange: (id: string) => void;
  label: string;
}) {
  const t = useAppTranslations("workflows");
  const selectedId = typeof value === "string" ? value : undefined;
  const read = useWorkflowConfigurationReferences({
    workflowId,
    type,
    selector: { kind: "builtin", name: field },
    selectedId,
    enabled: true,
  });
  return (
    <div className="space-y-2">
      <Input
        aria-label={label + " · " + t("customReferenceSearch")}
        value={read.search}
        maxLength={200}
        disabled={!editable || read.status === "denied"}
        onChange={(event) => read.onSearch(event.target.value)}
      />
      <Select
        ariaLabel={label + " · " + t("configurationSelectRecord")}
        value={selectedId ?? ""}
        disabled={!editable || read.status !== "ready"}
        placeholder={read.unavailable ? t("unavailableValue") : t("chooseValue")}
        options={read.options.map((option) => ({ value: option.id, label: option.label }))}
        onChange={(id) => {
          if (
            editable &&
            read.status === "ready" &&
            read.options.some((option) => option.id === id)
          )
            onChange(id);
        }}
      />
      {read.nextCursor !== null && (
        <Button
          type="button"
          variant="outline"
          disabled={read.loadingMore === true || read.status !== "ready"}
          onClick={() => {
            void read.onMore?.();
          }}
        >
          {t("customReferenceMore")}
        </Button>
      )}
      {read.status === "error" && (
        <p className="text-xs text-destructive">
          {t("configurationLookupError")}{" "}
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              void read.retry();
            }}
          >
            {t("retry")}
          </Button>
        </p>
      )}
      {read.status === "denied" && (
        <p className="text-xs text-destructive">{t("customReferenceDenied")}</p>
      )}
      {read.stale && <p className="text-xs text-destructive">{t("configurationMetadataStale")}</p>}
    </div>
  );
}
