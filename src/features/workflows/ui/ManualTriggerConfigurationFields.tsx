"use client";

import { Select } from "@/components/ui/Select";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import type { WorkflowNode } from "../schemas";
import { workflowManualLaunchScope } from "../workflowManualLaunchContract";

export function ManualTriggerConfigurationFields({
  node,
  editable,
  onChange,
}: {
  node: WorkflowNode;
  editable: boolean;
  onChange: (node: WorkflowNode) => void;
}) {
  const t = useAppTranslations("workflows");
  const scope = workflowManualLaunchScope(node.config);
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{t("manualAvailability")}</p>
      <Select
        ariaLabel={t("manualAvailability")}
        value={scope ?? ""}
        disabled={!editable}
        options={[
          { value: "global", label: t("manualGlobal") },
          { value: "deal", label: t("manualOnDeal") },
        ]}
        onChange={(value) => {
          if (editable && (value === "global" || value === "deal"))
            onChange({ ...node, config: value === "global" ? { scope: "global" } : {} });
        }}
      />
    </div>
  );
}
