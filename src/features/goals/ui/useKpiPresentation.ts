"use client";

import { useKpiHubMessages } from "@/features/goals/kpiHubMessages";
import { useKpiMessages } from "@/features/goals/kpiMessages";
import type { KpiCondition, KpiDefinition } from "@/features/goals/kpiModel";
import { useFormatters } from "@/lib/useFormatters";

export function useKpiPresentation() {
  const S = useKpiHubMessages();
  const B = useKpiMessages();
  const format = useFormatters();
  const value = (raw: string | null, definition: KpiDefinition): string => {
    if (raw === null) return "—";
    if (definition.unit === "money") return format.currency(raw, definition.currency);
    const amount = format.number(raw, { maximumFractionDigits: 4 });
    if (definition.unit === "percent")
      return format.number(Number(raw) / 100, { style: "percent", maximumFractionDigits: 4 });
    return definition.unit === "count"
      ? amount
      : `${amount} ${definition.unit === "custom" ? (definition.customUnit ?? "") : B.units[definition.unit]}`;
  };
  const condition = (rule: KpiCondition, definition: KpiDefinition): string => {
    if (rule.kind === "range")
      return `${S.range} ${value(rule.target, definition)} – ${value(rule.upperTarget ?? null, definition)}`;
    if (rule.kind === "improve")
      return `${S[rule.direction ?? "increase"]} ${value(rule.target, definition)} · ${S.baseline} ${value(rule.baseline ?? null, definition)}`;
    return `${S[rule.kind]} ${value(rule.target, definition)}`;
  };
  return { value, condition };
}
