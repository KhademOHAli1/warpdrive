import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { useFormatters } from "@/lib/useFormatters";
import { ifElsePortDetails } from "../ifElseBudget";
import type { WorkflowEdge, WorkflowNode } from "../schemas";

export type IfElsePortLabel = { index: number; fallback: boolean };

export function useIfElsePortLabel() {
  const t = useAppTranslations("workflows");
  const { number } = useFormatters();
  return (branch: IfElsePortLabel | null | undefined) => {
    if (branch == null) return t("ifElseRoute");
    if (branch.fallback) return t("ifElseElse");
    return branch.index === 0 ? t("ifElseIf") : t("ifElseElseIf", { number: number(branch.index) });
  };
}

export function useConditionPortLabel() {
  const t = useAppTranslations("workflows");
  const labelBranch = useIfElsePortLabel();
  return (port: WorkflowEdge["port"], source?: WorkflowNode) => {
    if (port === "next") return t("nextPort");
    if (port === "true") return t("truePort");
    if (port === "loop") return t("iteratorLoop");
    if (port === "done") return t("iteratorDone");
    if (port === "false") return t("conditionOtherwise");
    return labelBranch(source?.type === "ifElse" ? ifElsePortDetails(source.config, port) : null);
  };
}
