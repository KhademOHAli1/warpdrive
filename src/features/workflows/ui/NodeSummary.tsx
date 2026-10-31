"use client";

import { Tip } from "@/components/ui/tooltip";
import { useAppTranslations, useMessages } from "@/features/i18n/LocaleProvider";
import { useFormatters } from "@/lib/useFormatters";
import { bindingSchema, type WorkflowNode } from "../schemas";

export function NodeSummary({ node }: { node: WorkflowNode }) {
  const t = useAppTranslations("workflows");
  const sales = useAppTranslations("sales");
  const fmt = useFormatters();
  const fields: Record<string, string> = useMessages().workflows.fields;
  function value(input: unknown, status = false): string {
    const parsed = bindingSchema.safeParse(input);
    if (!parsed.success) return t("setupRequired");
    const binding = parsed.data;
    if (binding.kind === "reference") return fields[binding.path.join(".")] ?? t("mappedValue");
    if (binding.value === null || binding.value === "") return t("setupRequired");
    if (typeof binding.value === "boolean") return t(binding.value ? "boolTrue" : "boolFalse");
    if (typeof binding.value === "number") return fmt.number(binding.value);
    if (status && ["open", "won", "lost"].includes(binding.value))
      return sales(
        binding.value === "open"
          ? "computed.statusOpen"
          : binding.value === "won"
            ? "computed.statusWon"
            : "computed.statusLost",
      );
    return binding.value;
  }
  let summary = t("manualSummary");
  if (node.type === "activity.create") summary = value(node.config.subject);
  if (node.type === "record.read")
    summary = t("readSummary", { source: value(node.config.recordId) });
  if (node.type === "condition") {
    const left = bindingSchema.safeParse(node.config.left);
    const status =
      left.success && left.data.kind === "reference" && left.data.path.join(".") === "status";
    const operator = node.config.operator;
    const comparison =
      operator === "equals" ||
      operator === "notEquals" ||
      operator === "contains" ||
      operator === "exists"
        ? t(operator)
        : t("setupRequired");
    summary = t("conditionSummary", {
      left: value(node.config.left),
      operator: comparison,
      right: operator === "exists" ? "" : value(node.config.right, status),
    }).trim();
  }
  return (
    <Tip label={summary}>
      <p
        dir="auto"
        className="mt-3 line-clamp-2 break-words text-xs leading-5 text-muted-foreground"
      >
        {summary}
      </p>
    </Tip>
  );
}
