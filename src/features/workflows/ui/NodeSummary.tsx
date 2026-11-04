"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Tip } from "@/components/ui/tooltip";
import { useAppTranslations, useLocale, useMessages } from "@/features/i18n/LocaleProvider";
import { directionForLocale } from "@/features/i18n/registry";
import { useFormatters } from "@/lib/useFormatters";
import { delayMinutesSchema } from "../registry";
import { bindingSchema, type WorkflowDefinition, type WorkflowNode } from "../schemas";
import { conditionSummary } from "./conditionSummary";

function describeDelay(
  raw: unknown,
  invalid: string,
  mapped: string,
  format: (minutes: number) => string,
) {
  const binding = bindingSchema.safeParse(raw);
  if (!binding.success) return invalid;
  if (binding.data.kind === "reference") return mapped;
  const minutes = delayMinutesSchema.safeParse(binding.data.value);
  return minutes.success ? format(minutes.data) : invalid;
}

function ConditionSummary({
  node,
  definition,
}: {
  node: WorkflowNode;
  definition?: WorkflowDefinition;
}) {
  const t = useAppTranslations("workflows");
  const sales = useAppTranslations("sales");
  const locale = useLocale();
  const messages = useMessages().workflows;
  const format = useFormatters();
  const [expanded, setExpanded] = useState(false);
  const summary = conditionSummary({
    node,
    definition,
    locale,
    messages,
    number: (value) => format.number(value, { maximumSignificantDigits: 21 }),
    date: format.dateOnly,
    instant: format.dateTime,
    status: (value) =>
      sales(
        value === "open"
          ? "computed.statusOpen"
          : value === "won"
            ? "computed.statusWon"
            : "computed.statusLost",
      ),
  });
  return (
    <div dir={directionForLocale(locale)} className="mt-3 min-w-0 space-y-2">
      <Tip label={summary.text}>
        <p
          dir="auto"
          className={
            (expanded ? "" : "line-clamp-2 ") +
            "break-words text-xs leading-5 text-muted-foreground"
          }
        >
          {summary.text}
        </p>
      </Tip>
      {summary.grouped && (
        <p className="text-xs text-muted-foreground">
          {t(summary.count === 1 ? "conditionCountOne" : "conditionCount", {
            number: format.number(summary.count),
          })}
        </p>
      )}
      {summary.count > 2 && (
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {t(expanded ? "conditionCollapse" : "conditionExpand")}
        </Button>
      )}
    </div>
  );
}
export function NodeSummary({
  node,
  definition,
}: {
  node: WorkflowNode;
  definition?: WorkflowDefinition;
}) {
  const t = useAppTranslations("workflows");
  const sales = useAppTranslations("sales");
  const fmt = useFormatters();
  const fields: Record<string, string> = useMessages().workflows.fields;
  if (node.type === "condition") return <ConditionSummary node={node} definition={definition} />;
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
  if (node.type === "delay")
    summary = describeDelay(
      node.config.minutes,
      t("setupRequired"),
      t("delayLiteralRequired"),
      (minutes) => t("delaySummary", { minutes: fmt.number(minutes) }),
    );
  if (node.type === "activity.create") summary = value(node.config.subject);
  if (node.type === "record.read")
    summary = t("readSummary", { source: value(node.config.recordId) });
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
