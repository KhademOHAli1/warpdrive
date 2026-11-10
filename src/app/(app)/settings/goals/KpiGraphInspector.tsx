"use client";

import { Trash2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { CurrencySelect } from "@/features/currencies/CurrencySelect";
import { useKpiGraphMessages } from "@/features/goals/kpiGraphMessages";
import { useKpiHubMessages } from "@/features/goals/kpiHubMessages";
import { useKpiMessages } from "@/features/goals/kpiMessages";
import {
  KPI_CALCULATIONS,
  KPI_GRAPH_COMPARE,
  KPI_GRAPH_COMPUTE,
  type KpiDefinitionInput,
  type KpiGraph,
  type KpiGraphHandle,
  type KpiGraphNode,
  type KpiGraphNodeResult,
  type KpiStatus,
} from "@/features/goals/kpiModel";
import { kpiGraphInputHandles } from "@/features/goals/kpiGraphValidation";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import type { Locale } from "@/features/i18n/registry";
import { useFormatters } from "@/lib/useFormatters";
import { normalizeNumberInput } from "@/utils/normalizeNumberInput";
import { connectGraphInput } from "./KpiGraphModel";
import type { Option } from "./types";

export function KpiGraphField({
  label,
  children,
  help,
}: {
  label: string;
  children: ReactNode;
  help?: string;
}) {
  return (
    <div className="space-y-1.5">
      <span className="block text-xs font-medium text-muted-foreground">{label}</span>
      {children}
      {help !== undefined && (
        <p className="text-[11px] leading-relaxed text-muted-foreground">{help}</p>
      )}
    </div>
  );
}
function DecimalField({
  value,
  onChange,
  label,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  disabled: boolean;
}) {
  const { locale } = useLocalePreferences();
  const format = useFormatters();
  const [draft, setDraft] = useState<{ raw: string; canonical: string; locale: Locale } | null>(
    null,
  );
  const same = draft !== null && draft.canonical === value;
  const display = same
    ? draft.raw
    : /^-?\d+(\.\d{1,4})?$/u.test(value)
      ? format.number(value, { useGrouping: false, maximumFractionDigits: 4 })
      : value;
  return (
    <Input
      aria-label={label}
      disabled={disabled}
      inputMode="decimal"
      value={display}
      onChange={(event) => {
        const authoredLocale = same ? draft.locale : locale;
        const raw = event.target.value;
        const canonical = normalizeNumberInput(raw, authoredLocale) ?? raw.trim();
        setDraft({ raw, canonical, locale: authoredLocale });
        onChange(canonical);
      }}
    />
  );
}

type Metric = Omit<KpiDefinitionInput, "graph">;
interface MetricProps {
  metric: Metric;
  onChange: (metric: Metric) => void;
  baseCurrency: string;
  pipelines: Option[];
  activityTypes: Option[];
}
function ratioMetric(metric: Metric, calculation: "percentage" | "ratio"): Metric {
  return {
    ...metric,
    calculation,
    unit: calculation === "percentage" ? "percent" : "custom",
    customUnit: calculation === "ratio" ? (metric.customUnit ?? ": 1") : undefined,
    valueField: undefined,
    numeratorStatus: metric.source === "deals" ? "won" : "completed",
    denominatorStatus: metric.source === "deals" ? "closed" : "all",
    filters: { ...metric.filters, status: "all" },
    dateField:
      metric.source === "activities" && metric.dateField === "completed" ? "due" : metric.dateField,
  };
}
function chooseCalculation(metric: Metric, calculation: Metric["calculation"]): Metric {
  if (calculation === "count" || calculation === "distinct_count")
    return { ...metric, calculation, unit: "count", valueField: undefined };
  if (calculation === "percentage" || calculation === "ratio")
    return ratioMetric(metric, calculation);
  if (calculation === "duration" || metric.source === "activities")
    return {
      ...metric,
      calculation,
      unit: "days",
      valueField: metric.source === "deals" ? "sales_cycle" : "duration",
      dateField: metric.source === "deals" ? "closed" : metric.dateField,
    };
  return { ...metric, calculation, unit: "money", valueField: "value" };
}
function MetricAggregateFields({
  metric,
  onChange,
  baseCurrency,
}: Pick<MetricProps, "metric" | "onChange" | "baseCurrency">) {
  const B = useKpiMessages();
  const numeric = !["count", "distinct_count", "percentage", "ratio"].includes(metric.calculation);
  const duration = metric.valueField === "sales_cycle" || metric.valueField === "duration";
  return (
    <>
      <KpiGraphField label={B.calculation}>
        <Select
          ariaLabel={B.calculation}
          value={metric.calculation}
          options={KPI_CALCULATIONS.map((value) => ({ value, label: B.calculations[value] }))}
          onChange={(value) => onChange(chooseCalculation(metric, value as Metric["calculation"]))}
        />
      </KpiGraphField>
      {numeric && metric.source === "deals" && metric.calculation !== "duration" && (
        <KpiGraphField label={B.valueField}>
          <Select
            ariaLabel={B.valueField}
            value={metric.valueField ?? "value"}
            options={[
              { value: "value", label: B.fields.value },
              { value: "sales_cycle", label: B.fields.sales_cycle },
            ]}
            onChange={(value) =>
              onChange({
                ...metric,
                valueField: value as "value" | "sales_cycle",
                unit: value === "value" ? "money" : "days",
              })
            }
          />
        </KpiGraphField>
      )}
      {duration && (
        <KpiGraphField label={B.unit}>
          <Select
            ariaLabel={B.unit}
            value={metric.unit}
            options={[
              { value: "hours", label: B.units.hours },
              { value: "days", label: B.units.days },
            ]}
            onChange={(value) => onChange({ ...metric, unit: value as "hours" | "days" })}
          />
        </KpiGraphField>
      )}
      {metric.unit === "money" && (
        <KpiGraphField label={B.currency}>
          <CurrencySelect
            value={metric.currency ?? baseCurrency}
            onChange={(currency) => onChange({ ...metric, currency })}
          />
        </KpiGraphField>
      )}
      {metric.unit === "custom" && (
        <KpiGraphField label={B.customUnit}>
          <Input
            aria-label={B.customUnit}
            value={metric.customUnit ?? ""}
            maxLength={32}
            onChange={(event) => onChange({ ...metric, customUnit: event.target.value })}
          />
        </KpiGraphField>
      )}
    </>
  );
}
function MetricFilterFields({
  metric,
  onChange,
  pipelines,
  activityTypes,
}: Pick<MetricProps, "metric" | "onChange" | "pipelines" | "activityTypes">) {
  const B = useKpiMessages();
  const ratio = metric.calculation === "percentage" || metric.calculation === "ratio";
  const statuses: KpiStatus[] =
    metric.source === "deals"
      ? ["all", "won", "lost", "open", "closed"]
      : ["all", "open", "completed", "overdue"];
  const dates =
    metric.source === "deals"
      ? (["created", "closed"] as const)
      : (["created", "completed", "due"] as const);
  const statusOptions = statuses.map((value) => ({ value, label: B.statuses[value] }));
  return (
    <>
      <KpiGraphField label={B.dateField}>
        <Select
          ariaLabel={B.dateField}
          value={metric.dateField}
          options={dates.map((value) => ({ value, label: B.events[value] }))}
          disabled={metric.calculation === "duration" && metric.source === "deals"}
          onChange={(value) => onChange({ ...metric, dateField: value as Metric["dateField"] })}
        />
      </KpiGraphField>
      {ratio ? (
        <>
          <KpiGraphField label={B.numerator}>
            <Select
              ariaLabel={B.numerator}
              value={metric.numeratorStatus ?? "all"}
              options={statusOptions}
              onChange={(value) => onChange({ ...metric, numeratorStatus: value as KpiStatus })}
            />
          </KpiGraphField>
          <KpiGraphField label={B.denominator}>
            <Select
              ariaLabel={B.denominator}
              value={metric.denominatorStatus ?? "all"}
              options={statusOptions}
              onChange={(value) => onChange({ ...metric, denominatorStatus: value as KpiStatus })}
            />
          </KpiGraphField>
        </>
      ) : (
        <KpiGraphField label={B.numerator}>
          <Select
            ariaLabel={B.numerator}
            value={metric.filters.status ?? "all"}
            options={statusOptions}
            onChange={(value) =>
              onChange({ ...metric, filters: { ...metric.filters, status: value as KpiStatus } })
            }
          />
        </KpiGraphField>
      )}
      <KpiGraphField label={B.pipeline}>
        <Select
          ariaLabel={B.pipeline}
          value={metric.filters.pipelineId ?? ""}
          options={[
            { value: "", label: B.anyPipeline },
            ...pipelines.map((option) => ({ value: option.id, label: option.name })),
          ]}
          onChange={(value) =>
            onChange({ ...metric, filters: { ...metric.filters, pipelineId: value || null } })
          }
        />
      </KpiGraphField>
      {metric.source === "activities" && (
        <KpiGraphField label={B.activityType}>
          <Select
            ariaLabel={B.activityType}
            value={metric.filters.activityTypeId ?? ""}
            options={[
              { value: "", label: B.anyActivityType },
              ...activityTypes.map((option) => ({ value: option.id, label: option.name })),
            ]}
            onChange={(value) =>
              onChange({ ...metric, filters: { ...metric.filters, activityTypeId: value || null } })
            }
          />
        </KpiGraphField>
      )}
    </>
  );
}
function MetricFields(props: MetricProps) {
  const B = useKpiMessages();
  const L = useKpiGraphMessages();
  const { metric, onChange, baseCurrency } = props;
  return (
    <>
      <p className="text-[11px] leading-relaxed text-muted-foreground">{L.dataHint}</p>
      <KpiGraphField label={B.source}>
        <Select
          ariaLabel={B.source}
          value={metric.source}
          options={[
            { value: "deals", label: B.sources.deals },
            { value: "activities", label: B.sources.activities },
          ]}
          onChange={(source) =>
            onChange(
              source === "deals"
                ? {
                    name: metric.name,
                    description: metric.description,
                    source,
                    calculation: "sum",
                    unit: "money",
                    currency: baseCurrency,
                    dateField: "closed",
                    filters: { status: "won" },
                    valueField: "value",
                  }
                : {
                    name: metric.name,
                    description: metric.description,
                    source: "activities",
                    calculation: "count",
                    unit: "count",
                    dateField: "completed",
                    filters: { status: "completed" },
                  },
            )
          }
        />
      </KpiGraphField>
      <MetricAggregateFields {...props} />
      <MetricFilterFields {...props} />
    </>
  );
}

function InputPickers({
  node,
  graph,
  onInput,
}: {
  node: KpiGraphNode;
  graph: KpiGraph;
  onInput: (handle: KpiGraphHandle, source: string) => void;
}) {
  const L = useKpiGraphMessages();
  const format = useFormatters();
  const handles = kpiGraphInputHandles(node, graph);
  if (handles.length === 0) return null;
  return (
    <div className="space-y-4 border-t pt-4">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {L.inputs}
      </p>
      {handles.map((input) => {
        const label =
          L[
            input.handle === "value"
              ? "outputValue"
              : input.handle === "true"
                ? "trueRoute"
                : input.handle === "false"
                  ? "falseRoute"
                  : input.handle
          ];
        const connected =
          graph.edges.find((edge) => edge.target === node.id && edge.targetHandle === input.handle)
            ?.source ?? "";
        const options = graph.nodes.flatMap((source, index) =>
          connectGraphInput(graph, source.id, node.id, input.handle) === null
            ? []
            : [{ value: source.id, label: `${format.number(index + 1)} · ${source.label}` }],
        );
        return (
          <KpiGraphField key={input.handle} label={label}>
            <Select
              ariaLabel={`${L.inputs}: ${label}`}
              value={connected}
              placeholder={L.variable}
              options={[{ value: "", label: L.disconnected }, ...options]}
              onChange={(source) => onInput(input.handle, source)}
            />
          </KpiGraphField>
        );
      })}
    </div>
  );
}

interface Props {
  node: KpiGraphNode | undefined;
  graph: KpiGraph;
  onChange: (node: KpiGraphNode) => void;
  onInput: (handle: KpiGraphHandle, source: string) => void;
  onDelete: () => void;
  disabled: boolean;
  baseCurrency: string;
  pipelines: Option[];
  activityTypes: Option[];
  description: string;
  onDescription: (value: string) => void;
  result?: KpiGraphNodeResult;
}
function NodeConfiguration({
  node,
  onChange,
  baseCurrency,
  pipelines,
  activityTypes,
  description,
  onDescription,
  disabled,
}: Omit<Props, "node"> & { node: KpiGraphNode }) {
  const L = useKpiGraphMessages();
  switch (node.type) {
    case "metric":
      return (
        <MetricFields
          metric={node.metric}
          onChange={(metric) => onChange({ ...node, metric })}
          baseCurrency={baseCurrency}
          pipelines={pipelines}
          activityTypes={activityTypes}
        />
      );
    case "constant":
      return (
        <KpiGraphField label={L.value}>
          <DecimalField
            label={L.value}
            value={node.value}
            onChange={(value) => onChange({ ...node, value })}
            disabled={disabled}
          />
        </KpiGraphField>
      );
    case "compute":
      return (
        <KpiGraphField label={L.operation}>
          <Select
            ariaLabel={L.operation}
            value={node.operation}
            options={KPI_GRAPH_COMPUTE.map((value) => ({ value, label: L.operations[value] }))}
            onChange={(operation) =>
              onChange({ ...node, operation: operation as typeof node.operation })
            }
          />
        </KpiGraphField>
      );
    case "compare":
      return (
        <KpiGraphField label={L.operator}>
          <Select
            ariaLabel={L.operator}
            value={node.operator}
            options={KPI_GRAPH_COMPARE.map((value) => ({ value, label: L.comparisons[value] }))}
            onChange={(operator) =>
              onChange({ ...node, operator: operator as typeof node.operator })
            }
          />
        </KpiGraphField>
      );
    case "logic":
      return (
        <KpiGraphField label={L.operation}>
          <Select
            ariaLabel={L.operation}
            value={node.operation}
            options={(["and", "or", "not"] as const).map((value) => ({
              value,
              label: L.gates[value],
            }))}
            onChange={(operation) =>
              onChange({ ...node, operation: operation as typeof node.operation })
            }
          />
        </KpiGraphField>
      );
    case "branch":
      return <p className="text-xs leading-relaxed text-muted-foreground">{L.hint}</p>;
    case "output":
      return (
        <>
          <p className="text-xs leading-relaxed text-muted-foreground">{L.outputHint}</p>
          <KpiGraphField label={L.description}>
            <Textarea
              aria-label={L.description}
              value={description}
              maxLength={1200}
              onChange={(event) => onDescription(event.target.value)}
            />
          </KpiGraphField>
        </>
      );
  }
}
export function KpiGraphInspector(props: Props) {
  const L = useKpiGraphMessages();
  const H = useKpiHubMessages();
  const format = useFormatters();
  const { node, disabled, graph, onChange, onInput, onDelete, result } = props;
  if (node === undefined) return <p className="p-4 text-xs text-muted-foreground">{L.noNode}</p>;
  const resultText =
    result?.value === null || result === undefined
      ? L.unavailable
      : typeof result.value === "boolean"
        ? result.value
          ? L.trueValue
          : L.falseValue
        : format.number(result.value, { maximumFractionDigits: 4 });
  return (
    <div className="flex min-h-full flex-col">
      <fieldset disabled={disabled} className="space-y-4 p-4">
        <KpiGraphField label={L.nodeName}>
          <Input
            aria-label={L.nodeName}
            value={node.label}
            maxLength={120}
            onChange={(event) =>
              onChange(
                node.type === "metric"
                  ? {
                      ...node,
                      label: event.target.value,
                      metric: { ...node.metric, name: event.target.value },
                    }
                  : { ...node, label: event.target.value },
              )
            }
          />
        </KpiGraphField>
        <NodeConfiguration {...props} node={node} />
        <InputPickers node={node} graph={graph} onInput={onInput} />
        {result !== undefined && (
          <div className="border-t pt-4">
            <p className="text-xs text-muted-foreground">{L.nodeOutput}</p>
            <p className="mt-1 text-sm font-medium tabular-nums">{resultText}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {L[result.state === "available" ? "ready" : result.state]}
            </p>
            {result.issues.map((issue) => (
              <p key={issue} className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                {H.issues[issue] ?? L.unknownIssue}
              </p>
            ))}
          </div>
        )}
      </fieldset>
      <div className="mt-auto border-t p-3">
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={onDelete}
          className="text-destructive"
        >
          <Trash2 className="size-3.5" aria-hidden />
          {L.remove}
        </Button>
      </div>
    </div>
  );
}
