"use client";

import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  Database,
  Info,
  LoaderCircle,
  Target,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { DatePicker } from "@/components/ui/DatePicker";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { CurrencySelect } from "@/features/currencies/CurrencySelect";
import {
  assignKpiGoalAction,
  createKpiGoalAction,
  previewKpiAction,
  saveKpiDefinitionAction,
} from "@/features/goals/kpiActions";
import { kpiText, useKpiMessages } from "@/features/goals/kpiMessages";
import {
  KPI_CALCULATIONS,
  KPI_SOURCES,
  KPI_UNITS,
  type KpiCalculation,
  type KpiCondition,
  type KpiDefinition,
  type KpiDefinitionInput,
  type KpiGoalInput,
  type KpiMeasurement,
  type KpiPeriod,
  type KpiScope,
  type KpiSource,
  type KpiStatus,
} from "@/features/goals/kpiModel";
import {
  kpiConditionInput,
  kpiDefinitionInput,
  kpiPeriodInput,
  kpiScopeInput,
} from "@/features/goals/kpiSchemas";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import type { Locale } from "@/features/i18n/registry";
import { useFormatters } from "@/lib/useFormatters";
import { cn } from "@/lib/utils";
import { instantCivilDate } from "@/lib/zonedDateTime";
import { readCsrfToken } from "@/utils/csrfCookie";
import { normalizeNumberInput } from "@/utils/normalizeNumberInput";
import { KpiPreview } from "./KpiPreview";
import type { Option } from "./types";

export interface KpiBuilderProps {
  users: Option[];
  teams: Option[];
  pipelines: Option[];
  activityTypes: Option[];
  baseCurrency?: string;
  initial?: Partial<KpiDefinitionInput>;
  initialCondition?: KpiCondition;
  sourceRequirement?: string;
  definition?: KpiDefinition;
  revision?: KpiDefinition;
  onDone: () => void;
  onCancel: () => void;
  onBusyChange?: (busy: boolean) => void;
}

interface NumericDraft {
  raw: string;
  locale: Locale;
  canonical?: string;
  authored: boolean;
}
type DraftNumbers = { target: NumericDraft; upperTarget: NumericDraft; baseline: NumericDraft };
type PeriodChoice =
  | "weekly"
  | "monthly"
  | "quarterly"
  | "yearly"
  | "rolling30"
  | "rolling90"
  | "custom";

const SOURCE_STATUSES: Record<KpiSource, KpiStatus[]> = {
  deals: ["all", "won", "lost", "open", "closed"],
  activities: ["all", "open", "completed", "overdue"],
  manual: ["all"],
};
const SOURCE_DATE_FIELDS: Record<KpiSource, KpiDefinitionInput["dateField"][]> = {
  deals: ["created", "closed"],
  activities: ["created", "completed", "due"],
  manual: ["measured"],
};

function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-2">
      <span className="block text-sm font-medium">{label}</span>
      {children}
      {help !== undefined && help !== "" && (
        <p className="text-xs leading-relaxed text-muted-foreground">{help}</p>
      )}
    </div>
  );
}

function canonicalNumber(draft: NumericDraft): string {
  if (!draft.authored && draft.canonical !== undefined) return draft.canonical;
  return normalizeNumberInput(draft.raw, draft.locale) ?? draft.raw.trim();
}

function buildPeriod(
  periodChoice: PeriodChoice,
  startsOn: string,
  endsOn: string | null,
  fiscalStartMonth: number,
): KpiPeriod {
  const period: KpiPeriod = { kind: "calendar", interval: "monthly", startsOn, endsOn };
  if (periodChoice === "custom") period.kind = "one_off";
  else if (periodChoice === "rolling30" || periodChoice === "rolling90") {
    period.kind = "rolling";
    period.rollingDays = periodChoice === "rolling30" ? 30 : 90;
  } else period.interval = periodChoice;
  if (periodChoice === "quarterly" || periodChoice === "yearly")
    period.fiscalStartMonth = fiscalStartMonth;
  return period;
}

function ratioPatch(
  draft: KpiDefinitionInput,
  calculation: "percentage" | "ratio",
): Partial<KpiDefinitionInput> {
  return {
    calculation,
    unit: calculation === "percentage" ? "percent" : "custom",
    customUnit: calculation === "ratio" ? (draft.customUnit ?? ": 1") : undefined,
    filters: { ...draft.filters, status: "all" },
    numeratorStatus: draft.source === "deals" ? "won" : "completed",
    denominatorStatus: draft.source === "deals" ? "closed" : "all",
    // Include unfinished eligible work in the default activity population. A completion-date
    // denominator would contain only completed rows and make completion percentage trivial.
    dateField:
      draft.source === "activities" && draft.dateField === "completed" ? "due" : draft.dateField,
    valueField: undefined,
  };
}

function calculationPatch(
  draft: KpiDefinitionInput,
  calculation: KpiCalculation,
): Partial<KpiDefinitionInput> {
  if (draft.source === "manual") return { calculation };
  if (calculation === "percentage" || calculation === "ratio")
    return ratioPatch(draft, calculation);
  if (calculation === "count" || calculation === "distinct_count")
    return { calculation, unit: "count", valueField: undefined };
  if (calculation === "duration" || draft.source === "activities")
    return {
      calculation,
      unit: "days",
      valueField: draft.source === "deals" ? "sales_cycle" : "duration",
      dateField: draft.source === "deals" ? "closed" : draft.dateField,
    };
  return { calculation, unit: "money", valueField: "value" };
}

function supportedUnits(draft: KpiDefinitionInput): readonly KpiDefinitionInput["unit"][] {
  if (draft.source === "manual") return KPI_UNITS;
  if (draft.calculation === "percentage") return ["percent"];
  if (draft.calculation === "ratio") return ["custom"];
  if (["count", "distinct_count"].includes(draft.calculation)) return ["count"];
  if (
    draft.calculation === "duration" ||
    draft.valueField === "sales_cycle" ||
    draft.valueField === "duration"
  )
    return ["hours", "days"];
  return ["money"];
}

type BuilderCopy = ReturnType<typeof useKpiMessages>;
type BuilderFormat = ReturnType<typeof useFormatters>;

function summaryValue(
  raw: string | undefined,
  draft: KpiDefinitionInput,
  format: BuilderFormat,
  baseCurrency: string,
): string {
  if (raw === undefined || raw.trim() === "" || !Number.isFinite(Number(raw))) return "—";
  if (draft.unit === "money") return format.currency(raw, draft.currency ?? baseCurrency);
  if (draft.unit === "percent")
    return format.number(Number(raw) / 100, { style: "percent", maximumFractionDigits: 4 });
  if (draft.unit === "hours" || draft.unit === "days")
    return format.number(raw, {
      style: "unit",
      unit: draft.unit === "hours" ? "hour" : "day",
      unitDisplay: "long",
      maximumFractionDigits: 4,
    });
  const amount = format.number(raw, { maximumFractionDigits: 4 });
  if (draft.unit === "custom" && draft.customUnit !== undefined && draft.customUnit !== "")
    return `${amount} ${draft.customUnit}`;
  return amount;
}

function successSummary(
  condition: KpiCondition,
  draft: KpiDefinitionInput,
  L: BuilderCopy,
  format: BuilderFormat,
  baseCurrency: string,
): string {
  const target = summaryValue(condition.target, draft, format, baseCurrency);
  if (condition.kind === "range")
    return kpiText(L.summaryRange, {
      target,
      upper: summaryValue(condition.upperTarget, draft, format, baseCurrency),
    });
  if (condition.kind === "improve")
    return kpiText(condition.direction === "decrease" ? L.summaryDecrease : L.summaryIncrease, {
      target,
      baseline: summaryValue(condition.baseline, draft, format, baseCurrency),
    });
  return kpiText(L.summaryConditions[condition.kind], { target });
}

function lowerFirst(label: string, locale: Locale): string {
  return label.charAt(0).toLocaleLowerCase(locale) + label.slice(1);
}

function definitionExplanation(draft: KpiDefinitionInput, L: BuilderCopy, locale: Locale): string {
  const calculation = L.calculations[draft.calculation];
  if (draft.source === "manual") return kpiText(L.summaryManualBasis, { calculation });
  const recordLabel = (status: KpiStatus) =>
    kpiText(L.summaryRecord, {
      source:
        locale === "en" ? lowerFirst(L.sources[draft.source], locale) : L.sources[draft.source],
      status: lowerFirst(L.statuses[status], locale),
    });
  const date =
    locale === "en" ? lowerFirst(L.events[draft.dateField], locale) : L.events[draft.dateField];
  if (draft.calculation === "percentage" || draft.calculation === "ratio")
    return kpiText(L.summaryRatioBasis, {
      calculation,
      numerator: recordLabel(draft.numeratorStatus ?? "all"),
      denominator: recordLabel(draft.denominatorStatus ?? "all"),
      date,
    });
  return kpiText(L.summaryBasis, {
    calculation,
    records: recordLabel(draft.filters.status ?? "all"),
    date,
  });
}

function builderSummary({
  draft,
  condition,
  definitionOnly,
  scopeName,
  scopeKind,
  periodChoice,
  baseCurrency,
  L,
  format,
}: {
  draft: KpiDefinitionInput;
  condition: KpiCondition;
  definitionOnly: boolean;
  scopeName: string;
  scopeKind: KpiScope["scope"];
  periodChoice: PeriodChoice;
  baseCurrency: string;
  L: BuilderCopy;
  format: BuilderFormat;
}): string {
  if (draft.name.trim() === "") return L.summaryEmpty;
  if (definitionOnly) return kpiText(L.summaryDefinition, { name: draft.name });
  return kpiText(condition.kind === "improve" ? L.summaryImproveGoal : L.summaryGoal, {
    scope: scopeKind === "company" ? L.summaryCompany : scopeName,
    name: draft.name,
    success: successSummary(condition, draft, L, format, baseCurrency),
    period: L.summaryPeriods[periodChoice],
  });
}

async function persistBuilder({
  definitionOnly,
  definition,
  revision,
  draft,
  assignment,
}: {
  definitionOnly: boolean;
  definition: KpiDefinition | undefined;
  revision: KpiDefinition | undefined;
  draft: KpiDefinitionInput;
  assignment: Omit<KpiGoalInput, "definitionId">;
}) {
  const csrf = readCsrfToken();
  if (definitionOnly)
    return saveKpiDefinitionAction(
      {
        ...draft,
        ...(revision === undefined
          ? {}
          : { familyId: revision.familyId, expectedRevision: revision.revision }),
      },
      csrf,
    );
  if (definition !== undefined)
    return assignKpiGoalAction({ ...assignment, definitionId: definition.id }, csrf);
  return createKpiGoalAction({ definition: draft, assignment }, csrf);
}

/** New assignments pin the saved definition revision; editing a definition never mutates an assignment. */
function useKpiBuilder({
  users,
  teams,
  pipelines,
  activityTypes,
  baseCurrency = "USD",
  initial,
  initialCondition,
  sourceRequirement,
  definition,
  revision,
  onDone,
  onCancel,
  onBusyChange,
}: KpiBuilderProps) {
  const L = useKpiMessages();
  const preferences = useLocalePreferences();
  const format = useFormatters();
  const id = useId();
  const [step, setStep] = useState(definition ? 2 : 0);
  const [draft, setDraft] = useState<KpiDefinitionInput>(() => {
    const seed: KpiDefinitionInput = {
      name: "",
      description: "",
      source: "deals",
      calculation: "sum",
      unit: "money",
      currency: baseCurrency,
      dateField: "closed",
      filters: { status: "won" },
      valueField: "value",
      ...initial,
      ...revision,
      ...definition,
    };
    // Duplicate mode may receive a complete DTO. Identity fields are never part of a new draft.
    return {
      name: seed.name,
      description: seed.description,
      source: seed.source,
      calculation: seed.calculation,
      unit: seed.unit,
      currency: seed.currency,
      dateField: seed.dateField,
      filters: seed.filters,
      valueField: seed.valueField,
      customUnit: seed.customUnit,
      numeratorStatus: seed.numeratorStatus,
      denominatorStatus: seed.denominatorStatus,
    };
  });
  const [definitionOnly, setDefinitionOnly] = useState(!!revision);
  const [conditionKind, setConditionKind] = useState<KpiCondition["kind"]>(
    initialCondition?.kind ?? "at_least",
  );
  const [direction, setDirection] = useState<"increase" | "decrease">(
    initialCondition?.direction ?? "increase",
  );
  const [numbers, setNumbers] = useState<DraftNumbers>(() => {
    const display = (value: string): NumericDraft => ({
      raw: "",
      canonical: value,
      authored: false,
      locale: preferences.locale,
    });
    return {
      target: display(initialCondition?.target ?? "100"),
      upperTarget: display(initialCondition?.upperTarget ?? "120"),
      baseline: display(initialCondition?.baseline ?? "0"),
    };
  });
  const [scope, setScope] = useState<KpiScope>({ scope: "company", scopeId: null });
  const [periodChoice, setPeriodChoice] = useState<PeriodChoice>(
    initialCondition?.kind === "deadline" ? "custom" : "monthly",
  );
  const [fiscalStartMonth, setFiscalStartMonth] = useState(1);
  const [startsOn, setStartsOn] = useState(() =>
    instantCivilDate(new Date(), preferences.timeZone),
  );
  const [endsOn, setEndsOn] = useState<string | null>(
    initialCondition?.kind === "deadline"
      ? instantCivilDate(new Date(), preferences.timeZone)
      : null,
  );
  const [pacing, setPacing] = useState<"linear" | "none">("none");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<{ fingerprint: string; value: KpiMeasurement } | null>(
    null,
  );
  const [previewError, setPreviewError] = useState<string | null>(null);
  const busy = useRef(false);
  const generation = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current += 1;
    };
  }, []);

  const condition: KpiCondition = {
    kind: conditionKind,
    target: canonicalNumber(numbers.target),
    ...(conditionKind === "range" ? { upperTarget: canonicalNumber(numbers.upperTarget) } : {}),
    ...(conditionKind === "improve"
      ? { baseline: canonicalNumber(numbers.baseline), direction }
      : {}),
  };
  const period = buildPeriod(periodChoice, startsOn, endsOn, fiscalStartMonth);
  const previewFingerprint = JSON.stringify({
    draft,
    scope,
    period,
    condition,
    pacing,
    definitionOnly,
  });
  const currentPreview = preview?.fingerprint === previewFingerprint ? preview.value : null;
  const ratio = draft.calculation === "percentage" || draft.calculation === "ratio";
  const canPace =
    conditionKind === "at_least" &&
    Number(condition.target) > 0 &&
    period.kind !== "rolling" &&
    ["count", "distinct_count", "sum"].includes(draft.calculation);
  const statusOptions = SOURCE_STATUSES[draft.source].map((value) => ({
    value,
    label: L.statuses[value],
  }));
  const assigneeOptions = (scope.scope === "user" ? users : teams).map((option) => ({
    value: option.id,
    label: option.name,
  }));
  const scopeName =
    scope.scope === "company"
      ? L.scopes.company
      : ((scope.scope === "team" ? teams : users).find((option) => option.id === scope.scopeId)
          ?.name ?? L.scopes[scope.scope]);
  const dateOptions = SOURCE_DATE_FIELDS[draft.source].map((value) => ({
    value,
    label: L.events[value],
  }));
  const calculationOptions = (
    draft.source === "manual" ? ["sum", "average", "median"] : KPI_CALCULATIONS
  ).map((value) => ({ value, label: L.calculations[value as KpiCalculation] }));
  const measureOptions =
    draft.source === "deals"
      ? [
          { value: "value", label: L.fields.value },
          { value: "sales_cycle", label: L.fields.sales_cycle },
        ]
      : [{ value: "duration", label: L.fields.duration }];
  const unitValues = supportedUnits(draft);
  const unitOptions = unitValues.map((value) => ({
    value,
    label: L.units[value],
  }));
  const numericRaw = (key: keyof DraftNumbers): string =>
    numbers[key].authored
      ? numbers[key].raw
      : format.number(numbers[key].canonical ?? "0", {
          useGrouping: false,
          maximumFractionDigits: 4,
        });
  const summary = builderSummary({
    draft,
    condition,
    definitionOnly,
    scopeName,
    scopeKind: scope.scope,
    periodChoice,
    baseCurrency,
    L,
    format,
  });
  const explanation = definitionExplanation(draft, L, preferences.locale);

  function changed(): void {
    generation.current += 1;
    setError(null);
    setPreviewError(null);
  }
  function patchDefinition(patch: Partial<KpiDefinitionInput>): void {
    changed();
    setDraft((current) => ({ ...current, ...patch }));
  }
  function changeNumber(key: keyof DraftNumbers, raw: string): void {
    changed();
    setNumbers((current) => ({
      ...current,
      [key]: {
        raw,
        authored: true,
        locale: current[key].authored ? current[key].locale : preferences.locale,
      },
    }));
  }
  function chooseSource(source: string): void {
    if (source === "manual")
      patchDefinition({
        source,
        calculation: "average",
        unit: "count",
        dateField: "measured",
        valueField: undefined,
        filters: {},
        numeratorStatus: undefined,
        denominatorStatus: undefined,
      });
    else if (source === "activities")
      patchDefinition({
        source,
        calculation: "count",
        unit: "count",
        dateField: "completed",
        valueField: undefined,
        filters: { status: "completed" },
        numeratorStatus: undefined,
        denominatorStatus: undefined,
      });
    else
      patchDefinition({
        source: "deals",
        calculation: "sum",
        unit: "money",
        dateField: "closed",
        valueField: "value",
        filters: { status: "won" },
        numeratorStatus: undefined,
        denominatorStatus: undefined,
      });
    setPacing("none");
  }
  function chooseCalculation(value: string): void {
    patchDefinition(calculationPatch(draft, value as KpiCalculation));
    setPacing("none");
  }
  function chooseCondition(value: string): void {
    changed();
    setConditionKind(value as KpiCondition["kind"]);
    setPacing("none");
    if (value === "deadline") {
      setPeriodChoice("custom");
      setEndsOn(endsOn ?? startsOn);
    }
  }
  function validate(stage: number): string | null {
    if (draft.name.trim() === "") return L.validationName;
    if (stage === 0) return null;
    if (!kpiDefinitionInput.safeParse(draft).success) return L.validationDefinition;
    if (stage === 1) return null;
    if (!kpiScopeInput.safeParse(scope).success) return L.validationAssignee;
    if (
      !kpiPeriodInput.safeParse(period).success ||
      (conditionKind === "deadline" && period.kind !== "one_off")
    )
      return L.validationDate;
    if (definitionOnly || kpiConditionInput.safeParse(condition).success) return null;
    if (conditionKind === "range" && Number(condition.upperTarget) < Number(condition.target))
      return L.validationRange;
    return L.validationNumber;
  }
  function next(): void {
    const problem = validate(step);
    if (problem !== null) {
      setError(problem);
      return;
    }
    setError(null);
    setStep((current) => Math.min(3, current + 1));
  }
  function actionError(errorId: string): string {
    if (errorId === "E_KPI_NOT_READY") return L.storageUnavailable;
    if (errorId === "E_PERM_DENIED" || errorId === "E_AUTH_SESSION_DEAD") return L.permissionDenied;
    return L.saveFailed;
  }
  async function runPreview(): Promise<void> {
    if (busy.current) return;
    const problem = validate(2);
    if (problem !== null) {
      setError(problem);
      return;
    }
    busy.current = true;
    setPreviewing(true);
    onBusyChange?.(true);
    setPreviewError(null);
    const currentGeneration = generation.current;
    try {
      const result = await previewKpiAction(draft, scope, period, readCsrfToken());
      if (!mounted.current || currentGeneration !== generation.current) return;
      if (result.ok) setPreview({ fingerprint: previewFingerprint, value: result.value });
      else
        setPreviewError(
          result.error.id === "E_KPI_NOT_READY" ? L.storageUnavailable : L.previewFailed,
        );
    } catch {
      if (mounted.current && currentGeneration === generation.current)
        setPreviewError(L.previewFailed);
    } finally {
      busy.current = false;
      if (mounted.current) {
        setPreviewing(false);
        onBusyChange?.(false);
      }
    }
  }
  async function save(): Promise<void> {
    if (busy.current) return;
    const problem = validate(3);
    if (problem !== null) {
      setError(problem);
      return;
    }
    if (!currentPreview) {
      setError(L.previewRequired);
      return;
    }
    busy.current = true;
    setSaving(true);
    onBusyChange?.(true);
    setError(null);
    try {
      const assignment: Omit<KpiGoalInput, "definitionId"> = {
        condition,
        period,
        ...scope,
        pacing: canPace ? pacing : "none",
      };
      const result = await persistBuilder({
        definitionOnly,
        definition,
        revision,
        draft,
        assignment,
      });
      if (!result.ok) {
        if (mounted.current) setError(actionError(result.error.id));
        return;
      }
      if (mounted.current) onDone();
    } catch {
      if (mounted.current) setError(L.saveFailed);
    } finally {
      busy.current = false;
      if (mounted.current) {
        setSaving(false);
        onBusyChange?.(false);
      }
    }
  }

  const title = [L.defineTitle, L.measureTitle, L.targetTitle, L.reviewTitle][step];
  const description = [L.defineBody, L.measureBody, L.targetBody, L.reviewBody][step];
  return {
    L,
    preferences,
    format,
    id,
    step,
    setStep,
    draft,
    definition,
    revision,
    sourceRequirement,
    baseCurrency,
    pipelines,
    activityTypes,
    saving,
    previewing,
    title,
    description,
    setError,
    patchDefinition,
    chooseSource,
    calculationOptions,
    unitOptions,
    measureOptions,
    dateOptions,
    ratio,
    chooseCalculation,
    statusOptions,
    definitionOnly,
    changed,
    setDefinitionOnly,
    scope,
    setScope,
    assigneeOptions,
    periodChoice,
    conditionKind,
    setPeriodChoice,
    setPacing,
    endsOn,
    setEndsOn,
    startsOn,
    setStartsOn,
    fiscalStartMonth,
    setFiscalStartMonth,
    direction,
    setDirection,
    numericRaw,
    changeNumber,
    chooseCondition,
    canPace,
    pacing,
    preview,
    currentPreview,
    previewError,
    runPreview,
    summary,
    explanation,
    scopeName,
    error,
    onCancel,
    next,
    save,
  };
}

type BuilderModel = ReturnType<typeof useKpiBuilder>;

export function KpiBuilder(props: KpiBuilderProps): React.ReactElement {
  const model = useKpiBuilder(props);
  const {
    L,
    format,
    id,
    step,
    setStep,
    saving,
    previewing,
    title,
    description,
    setError,
    definitionOnly,
    currentPreview,
    summary,
    explanation,
    scopeName,
    error,
    onCancel,
    next,
    save,
  } = model;
  return (
    <div className="space-y-6" aria-busy={saving || previewing}>
      <nav
        aria-label={L.steps.join(" · ")}
        className="grid grid-cols-4 gap-1 border-b pb-5 sm:gap-4"
      >
        {L.steps.map((label, index) => (
          <Button
            variant="ghost"
            key={label}
            type="button"
            disabled={saving || previewing || index > step}
            onClick={() => {
              setError(null);
              setStep(index);
            }}
            aria-current={index === step ? "step" : undefined}
            className={cn(
              "flex min-h-10 items-center justify-center gap-2 rounded-md text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring sm:justify-start sm:text-sm",
              index === step ? "text-foreground" : "text-muted-foreground",
              index > step && "opacity-50",
            )}
          >
            <span
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs tabular-nums",
                index === step
                  ? "border-link/30 bg-link/10 text-link"
                  : index < step
                    ? "border-transparent bg-muted text-foreground"
                    : "border-border",
              )}
            >
              {index < step ? (
                <Check className="size-3" aria-hidden="true" />
              ) : (
                format.number(index + 1)
              )}
            </span>
            <span className="hidden min-[360px]:inline">{label}</span>
          </Button>
        ))}
      </nav>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_280px] lg:gap-8">
        <div className="min-w-0 space-y-6">
          <header>
            <h3 className="text-lg font-medium tracking-tight">{title}</h3>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
              {description}
            </p>
          </header>
          <fieldset disabled={saving || previewing} className="min-w-0 space-y-5">
            {step === 0 && <KpiDefineStep model={model} />}
            {step === 1 && <KpiMeasureStep model={model} />}
            {step === 2 && <KpiTargetStep model={model} />}
            {step === 3 && <KpiReviewStep model={model} />}
          </fieldset>
        </div>
        <aside className="rounded-xl border bg-muted/20 p-5 lg:sticky lg:top-0">
          <span className="flex size-9 items-center justify-center rounded-lg border bg-background text-link">
            <Target className="size-4" aria-hidden="true" />
          </span>
          <p className="mt-5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {L.summary}
          </p>
          <p className="mt-3 break-words text-sm leading-7">{summary}</p>
          <dl className="mt-6 space-y-4 border-t pt-4 text-xs">
            <div>
              <dt className="text-muted-foreground">{L.definitionLabel}</dt>
              <dd className="mt-1.5 font-medium">{explanation}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{L.targetLabel}</dt>
              <dd className="mt-1.5 font-medium">{definitionOnly ? L.optional : scopeName}</dd>
            </div>
          </dl>
          <p className="mt-5 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            {L.revisionLabel}
          </p>
        </aside>
      </div>
      {error !== null && (
        <p
          id={`${id}-error`}
          role="alert"
          className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {error}
        </p>
      )}
      <footer className="sticky bottom-0 z-20 flex flex-wrap items-center justify-between gap-3 border-t bg-background py-4">
        <Button variant="ghost" disabled={saving || previewing} onClick={onCancel}>
          {L.cancel}
        </Button>
        <div className="flex items-center gap-2">
          {step > 0 && (
            <Button
              variant="outline"
              disabled={saving || previewing}
              onClick={() => {
                setError(null);
                setStep((current) => current - 1);
              }}
            >
              <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden="true" />
              {L.back}
            </Button>
          )}
          {step < 3 ? (
            <Button disabled={saving || previewing} onClick={next}>
              {L.next}
              <ArrowRight className="size-4 rtl:rotate-180" aria-hidden="true" />
            </Button>
          ) : (
            <Button
              disabled={saving || previewing || !currentPreview}
              onClick={() => {
                void save();
              }}
            >
              {saving && (
                <LoaderCircle
                  className="size-4 animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
              )}
              {saving ? L.saving : definitionOnly ? L.saveDefinition : L.createGoal}
            </Button>
          )}
        </div>
      </footer>
    </div>
  );
}

function KpiDefineStep({ model }: { model: BuilderModel }): React.ReactElement {
  const { L, draft, definition, sourceRequirement, patchDefinition } = model;
  return (
    <>
      <Field label={L.name}>
        <Input
          autoFocus
          aria-label={L.name}
          placeholder={L.namePlaceholder}
          value={draft.name}
          maxLength={120}
          disabled={!!definition}
          onChange={(event) => patchDefinition({ name: event.target.value })}
        />
      </Field>
      <Field label={L.description}>
        <Textarea
          aria-label={L.description}
          placeholder={L.descriptionPlaceholder}
          value={draft.description}
          maxLength={1200}
          disabled={!!definition}
          onChange={(event) => patchDefinition({ description: event.target.value })}
          className="min-h-28 resize-y"
        />
      </Field>
      {sourceRequirement !== undefined && sourceRequirement !== "" && (
        <SourceRequirement label={L.sourceRequirement} value={sourceRequirement} />
      )}
      {definition && <Notice>{L.pinnedDefinition}</Notice>}
    </>
  );
}

function KpiMeasureStep({ model }: { model: BuilderModel }): React.ReactElement {
  const {
    L,
    draft,
    definition,
    sourceRequirement,
    baseCurrency,
    pipelines,
    activityTypes,
    patchDefinition,
    chooseSource,
    calculationOptions,
    unitOptions,
    measureOptions,
    dateOptions,
    ratio,
    chooseCalculation,
    statusOptions,
  } = model;
  return (
    <>
      {definition && <Notice>{L.pinnedDefinition}</Notice>}
      <Field label={L.source} help={L.sourceHelp}>
        <Select
          ariaLabel={L.source}
          value={draft.source}
          onChange={chooseSource}
          disabled={!!definition}
          options={KPI_SOURCES.map((value) => ({ value, label: L.sources[value] }))}
        />
      </Field>
      {draft.source === "manual" && <Notice>{L.manualNotice}</Notice>}
      {sourceRequirement !== undefined && sourceRequirement !== "" && (
        <SourceRequirement label={L.sourceRequirement} value={sourceRequirement} />
      )}
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={L.calculation}>
          <Select
            ariaLabel={L.calculation}
            value={draft.calculation}
            onChange={chooseCalculation}
            disabled={!!definition}
            options={calculationOptions}
          />
        </Field>
        <Field label={L.unit}>
          <Select
            ariaLabel={L.unit}
            value={draft.unit}
            onChange={(unit) => patchDefinition({ unit: unit as KpiDefinitionInput["unit"] })}
            disabled={!!definition}
            options={unitOptions}
          />
        </Field>
        {draft.unit === "money" && (
          <Field label={L.currency}>
            <div inert={!!definition}>
              <CurrencySelect
                value={draft.currency ?? baseCurrency}
                onChange={(currency) => patchDefinition({ currency })}
              />
            </div>
          </Field>
        )}
        {draft.unit === "custom" && (
          <Field label={L.customUnit}>
            <Input
              aria-label={L.customUnit}
              value={draft.customUnit ?? ""}
              maxLength={32}
              disabled={!!definition}
              onChange={(event) => patchDefinition({ customUnit: event.target.value })}
            />
          </Field>
        )}
        {!ratio &&
          !["count", "distinct_count"].includes(draft.calculation) &&
          draft.source !== "manual" && (
            <Field label={L.valueField}>
              <Select
                ariaLabel={L.valueField}
                value={draft.valueField ?? (draft.source === "deals" ? "value" : "duration")}
                disabled={!!definition || draft.calculation === "duration"}
                options={measureOptions}
                onChange={(valueField) =>
                  patchDefinition({
                    valueField: valueField as KpiDefinitionInput["valueField"],
                    unit: valueField === "value" ? "money" : "days",
                  })
                }
              />
            </Field>
          )}
        <Field label={L.dateField}>
          <Select
            ariaLabel={L.dateField}
            value={draft.dateField}
            disabled={
              !!definition || (draft.calculation === "duration" && draft.source === "deals")
            }
            options={dateOptions}
            onChange={(dateField) =>
              patchDefinition({ dateField: dateField as KpiDefinitionInput["dateField"] })
            }
          />
        </Field>
      </div>
      {draft.source !== "manual" && (
        <div className="space-y-5 rounded-lg border bg-muted/15 p-4">
          {ratio ? (
            <>
              <Field label={L.numerator}>
                <Select
                  ariaLabel={L.numerator}
                  value={draft.numeratorStatus ?? "all"}
                  disabled={!!definition}
                  options={statusOptions}
                  onChange={(value) => patchDefinition({ numeratorStatus: value as KpiStatus })}
                />
              </Field>
              <div className="border-t" />
              <Field label={L.denominator} help={L.calculationHelp}>
                <Select
                  ariaLabel={L.denominator}
                  value={draft.denominatorStatus ?? "all"}
                  disabled={!!definition}
                  options={statusOptions}
                  onChange={(value) => patchDefinition({ denominatorStatus: value as KpiStatus })}
                />
              </Field>
            </>
          ) : (
            <Field label={L.numerator}>
              <Select
                ariaLabel={L.numerator}
                value={draft.filters.status ?? "all"}
                disabled={!!definition}
                options={statusOptions}
                onChange={(value) =>
                  patchDefinition({
                    filters: { ...draft.filters, status: value as KpiStatus },
                  })
                }
              />
            </Field>
          )}
          <Field label={L.pipeline}>
            <Select
              ariaLabel={L.pipeline}
              value={draft.filters.pipelineId ?? ""}
              disabled={!!definition}
              options={[
                { value: "", label: L.anyPipeline },
                ...pipelines.map((option) => ({ value: option.id, label: option.name })),
              ]}
              onChange={(value) =>
                patchDefinition({
                  filters: { ...draft.filters, pipelineId: value || null },
                })
              }
            />
          </Field>
          {draft.source === "activities" && (
            <Field label={L.activityType}>
              <Select
                ariaLabel={L.activityType}
                value={draft.filters.activityTypeId ?? ""}
                disabled={!!definition}
                options={[
                  { value: "", label: L.anyActivityType },
                  ...activityTypes.map((option) => ({
                    value: option.id,
                    label: option.name,
                  })),
                ]}
                onChange={(value) =>
                  patchDefinition({
                    filters: { ...draft.filters, activityTypeId: value || null },
                  })
                }
              />
            </Field>
          )}
        </div>
      )}
    </>
  );
}

function KpiTargetStep({ model }: { model: BuilderModel }): React.ReactElement {
  const {
    L,
    preferences,
    definition,
    revision,
    id,
    definitionOnly,
    changed,
    setDefinitionOnly,
    scope,
    setScope,
    assigneeOptions,
    periodChoice,
    conditionKind,
    setPeriodChoice,
    setPacing,
    endsOn,
    setEndsOn,
    startsOn,
    setStartsOn,
    fiscalStartMonth,
    setFiscalStartMonth,
    direction,
    setDirection,
    numericRaw,
    changeNumber,
    chooseCondition,
    canPace,
    pacing,
  } = model;
  return (
    <>
      {!definition && !revision && (
        <label
          htmlFor={`${id}-definition-only`}
          className="flex cursor-pointer items-start gap-3 rounded-lg border bg-muted/15 p-4"
        >
          <Checkbox
            id={`${id}-definition-only`}
            label={L.definitionOnly}
            checked={definitionOnly}
            onCheckedChange={(checked) => {
              changed();
              setDefinitionOnly(checked);
            }}
            className="mt-0.5 size-4"
          />
          <span>
            <span className="block text-sm font-medium">{L.definitionOnly}</span>
            <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
              {L.definitionOnlyHelp}
            </span>
          </span>
        </label>
      )}
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={L.scope}>
          <Select
            ariaLabel={L.scope}
            value={scope.scope}
            options={(["company", "team", "user"] as const).map((value) => ({
              value,
              label: L.scopes[value],
            }))}
            onChange={(value) => {
              changed();
              setScope({ scope: value as KpiScope["scope"], scopeId: null });
            }}
          />
        </Field>
        {scope.scope !== "company" && (
          <Field label={L.assignee}>
            <Select
              ariaLabel={L.assignee}
              value={scope.scopeId ?? ""}
              placeholder={L.selectAssignee}
              options={[{ value: "", label: L.selectAssignee }, ...assigneeOptions]}
              onChange={(scopeId) => {
                changed();
                setScope((current) => ({ ...current, scopeId: scopeId || null }));
              }}
            />
          </Field>
        )}
        <Field label={L.period}>
          <Select
            ariaLabel={L.period}
            value={periodChoice}
            disabled={!definitionOnly && conditionKind === "deadline"}
            options={Object.entries(L.periods).map(([value, label]) => ({
              value,
              label,
            }))}
            onChange={(value) => {
              changed();
              setPeriodChoice(value as PeriodChoice);
              setPacing("none");
              if (value === "custom") setEndsOn(endsOn ?? startsOn);
            }}
          />
        </Field>
        {["quarterly", "yearly"].includes(periodChoice) && (
          <Field label={L.fiscalMonth} help={L.fiscalMonthHelp}>
            <Select
              ariaLabel={L.fiscalMonth}
              value={String(fiscalStartMonth)}
              options={Array.from({ length: 12 }, (_, index) => ({
                value: String(index + 1),
                label: new Intl.DateTimeFormat(preferences.locale, {
                  month: "long",
                  calendar: "gregory",
                  timeZone: "UTC",
                }).format(new Date(Date.UTC(2026, index, 1))),
              }))}
              onChange={(value) => {
                changed();
                setFiscalStartMonth(Number(value));
              }}
            />
          </Field>
        )}
        <Field label={L.startsOn}>
          <DatePicker
            ariaLabel={L.startsOn}
            value={startsOn}
            onChange={(value) => {
              if (value !== null) {
                changed();
                setStartsOn(value);
              }
            }}
          />
        </Field>
        <Field label={L.endsOn}>
          <DatePicker
            ariaLabel={L.endsOn}
            value={endsOn}
            placeholder={L.noEnd}
            onChange={(value) => {
              changed();
              setEndsOn(value);
            }}
          />
        </Field>
      </div>
      {!definitionOnly && (
        <>
          <div className="border-t pt-5">
            <Field label={L.success}>
              <Select
                ariaLabel={L.success}
                value={conditionKind}
                options={Object.entries(L.conditions).map(([value, label]) => ({
                  value,
                  label,
                }))}
                onChange={chooseCondition}
              />
            </Field>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label={L.target} help={L.zeroHelp}>
              <Input
                aria-label={L.target}
                inputMode="decimal"
                value={numericRaw("target")}
                onChange={(event) => changeNumber("target", event.target.value)}
              />
            </Field>
            {conditionKind === "range" && (
              <Field label={L.upperTarget}>
                <Input
                  aria-label={L.upperTarget}
                  inputMode="decimal"
                  value={numericRaw("upperTarget")}
                  onChange={(event) => changeNumber("upperTarget", event.target.value)}
                />
              </Field>
            )}
            {conditionKind === "improve" && (
              <>
                <Field label={L.baseline}>
                  <Input
                    aria-label={L.baseline}
                    inputMode="decimal"
                    value={numericRaw("baseline")}
                    onChange={(event) => changeNumber("baseline", event.target.value)}
                  />
                </Field>
                <Field label={L.improvementDirection}>
                  <Select
                    ariaLabel={L.improvementDirection}
                    value={direction}
                    options={[
                      { value: "increase", label: L.directionUp },
                      { value: "decrease", label: L.directionDown },
                    ]}
                    onChange={(value) => {
                      changed();
                      setDirection(value as "increase" | "decrease");
                    }}
                  />
                </Field>
              </>
            )}
          </div>
          <Field label={L.pacing} help={L.pacingHelp}>
            <Select
              ariaLabel={L.pacing}
              value={canPace ? pacing : "none"}
              options={[
                { value: "none", label: L.noPacing },
                ...(canPace ? [{ value: "linear", label: L.linearPacing }] : []),
              ]}
              onChange={(value) => {
                changed();
                setPacing(value as "linear" | "none");
              }}
            />
          </Field>
        </>
      )}
    </>
  );
}

function KpiReviewStep({ model }: { model: BuilderModel }): React.ReactElement {
  const {
    L,
    draft,
    sourceRequirement,
    saving,
    previewing,
    preview,
    currentPreview,
    previewError,
    runPreview,
  } = model;
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
        <div className="min-w-0">
          <p className="text-sm font-medium">{draft.name}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {L.sources[draft.source]}
            <ChevronRight aria-hidden="true" className="mx-1 inline size-3 rtl:rotate-180" />
            {L.calculations[draft.calculation]}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={previewing || saving}
          onClick={() => {
            void runPreview();
          }}
        >
          {previewing ? (
            <LoaderCircle
              aria-hidden="true"
              className="size-4 animate-spin motion-reduce:animate-none"
            />
          ) : (
            <Database aria-hidden="true" className="size-4" />
          )}
          {preview ? L.refreshPreview : L.preview}
        </Button>
      </div>
      {sourceRequirement !== undefined && sourceRequirement !== "" && (
        <SourceRequirement label={L.sourceRequirement} value={sourceRequirement} />
      )}
      <KpiPreview
        definition={draft}
        measurement={currentPreview}
        loading={previewing}
        error={previewError}
        changed={preview !== null && currentPreview === null}
      />
    </>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-lg border border-link/15 bg-link/5 p-3 text-xs leading-relaxed text-muted-foreground">
      <Info className="mt-0.5 size-4 shrink-0 text-link" aria-hidden="true" />
      {children}
    </p>
  );
}

function SourceRequirement({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-muted/20 p-4">
      <p className="text-xs font-medium">{label}</p>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{value}</p>
    </div>
  );
}
