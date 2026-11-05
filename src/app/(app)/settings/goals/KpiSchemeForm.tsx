"use client";

import { type ReactNode, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { DatePicker } from "@/components/ui/DatePicker";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import {
  applyKpiSchemeAction,
  createKpiPackAction,
  recordKpiMeasurementAction,
  saveKpiSchemeAction,
} from "@/features/goals/kpiActions";
import type { KpiPack } from "@/features/goals/kpiCatalog";
import { useKpiHubMessages } from "@/features/goals/kpiHubMessages";
import { useKpiMessages } from "@/features/goals/kpiMessages";
import type {
  KpiCondition,
  KpiDefinition,
  KpiGoalResult,
  KpiPeriod,
  KpiScheme,
} from "@/features/goals/kpiModel";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import type { Locale } from "@/features/i18n/registry";
import { useFormatters } from "@/lib/useFormatters";
import { readCsrfToken } from "@/utils/csrfCookie";
import { normalizeNumberInput } from "@/utils/normalizeNumberInput";
import { GoalFormField as Field } from "./GoalFormField";
import type { Option } from "./types";

interface Lifecycle {
  onDone: () => void;
  onCancel: () => void;
  onBusyChange: (busy: boolean) => void;
}

function useSave(lifecycle: Lifecycle, disabled = false, submitLabel?: string) {
  const S = useKpiHubMessages();
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const run = async (action: () => Promise<{ ok: boolean }>) => {
    if (lock.current || disabled) return;
    lock.current = true;
    setBusy(true);
    lifecycle.onBusyChange(true);
    setError(false);
    try {
      const result = await action();
      if (result.ok) lifecycle.onDone();
      else setError(true);
    } catch {
      setError(true);
    } finally {
      lock.current = false;
      setBusy(false);
      lifecycle.onBusyChange(false);
    }
  };
  const footer = (
    <>
      <div className="flex justify-end gap-2 border-t pt-4">
        <Button variant="outline" disabled={busy} onClick={lifecycle.onCancel}>
          {S.cancel}
        </Button>
        <Button type="submit" disabled={busy || disabled}>
          {busy ? S.saving : (submitLabel ?? S.save)}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {S.saveFailed}
        </p>
      )}
    </>
  );
  return { busy, run, footer };
}

export function KpiConditionFields({
  condition,
  onChange,
  prefix,
}: {
  condition: KpiCondition;
  onChange: (v: KpiCondition) => void;
  prefix: string;
}): ReactNode {
  const S = useKpiHubMessages();
  const format = useFormatters();
  const { locale } = useLocalePreferences();
  const [drafts, setDrafts] = useState<
    Partial<Record<"target" | "upperTarget" | "baseline", { raw: string; locale: Locale }>>
  >({});
  const display = (field: "target" | "upperTarget" | "baseline") => {
    const authored = drafts[field]?.raw;
    if (authored !== undefined) return authored;
    const canonical = condition[field];
    return canonical === undefined
      ? ""
      : format.number(canonical, { useGrouping: false, maximumFractionDigits: 4 });
  };
  const update = (field: "target" | "upperTarget" | "baseline", raw: string) => {
    const authoredLocale = drafts[field]?.locale ?? locale;
    setDrafts((current) => ({ ...current, [field]: { raw, locale: authoredLocale } }));
    onChange({ ...condition, [field]: normalizeNumberInput(raw, authoredLocale) ?? raw.trim() });
  };
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label={S.target}>
        <Select
          ariaLabel={`${prefix}: ${S.target}`}
          value={condition.kind}
          onChange={(v) =>
            onChange({
              ...condition,
              kind: v as KpiCondition["kind"],
              upperTarget: condition.upperTarget ?? condition.target,
              baseline: condition.baseline ?? "0",
              direction: condition.direction ?? "increase",
            })
          }
          options={["at_least", "at_most", "range", "improve", "deadline"].map((kind) => ({
            value: kind,
            label: S[kind as "at_least"],
          }))}
        />
      </Field>
      <Field label={S.threshold}>
        <Input
          aria-label={`${prefix}: ${S.threshold}`}
          inputMode="decimal"
          required
          value={display("target")}
          onChange={(e) => update("target", e.target.value)}
        />
      </Field>
      {condition.kind === "range" && (
        <Field label={S.upperTarget}>
          <Input
            aria-label={`${prefix}: ${S.upperTarget}`}
            inputMode="decimal"
            required
            value={display("upperTarget")}
            onChange={(e) => update("upperTarget", e.target.value)}
          />
        </Field>
      )}
      {condition.kind === "improve" && (
        <>
          <Field label={S.baseline}>
            <Input
              aria-label={`${prefix}: ${S.baseline}`}
              inputMode="decimal"
              required
              value={display("baseline")}
              onChange={(e) => update("baseline", e.target.value)}
            />
          </Field>
          <Field label={S.direction}>
            <Select
              ariaLabel={`${prefix}: ${S.direction}`}
              value={condition.direction ?? "increase"}
              onChange={(v) => onChange({ ...condition, direction: v as "increase" | "decrease" })}
              options={[
                { value: "increase", label: S.increase },
                { value: "decrease", label: S.decrease },
              ]}
            />
          </Field>
        </>
      )}
    </div>
  );
}

export function KpiSchemeForm({
  definitions,
  initial,
  duplicate,
  ...lifecycle
}: Lifecycle & {
  definitions: KpiDefinition[];
  initial?: KpiScheme;
  duplicate?: boolean;
}): ReactNode {
  const S = useKpiHubMessages();
  const format = useFormatters();
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [entries, setEntries] = useState<Record<string, KpiCondition>>(() =>
    Object.fromEntries((initial?.entries ?? []).map((e) => [e.definitionId, { ...e.condition }])),
  );
  const { busy, run, footer } = useSave(lifecycle, Object.keys(entries).length === 0);
  // A published scorecard may pin an older definition revision; the caller supplies those too.
  return (
    <form
      className="space-y-5"
      aria-busy={busy}
      onSubmit={(e) => {
        e.preventDefault();
        void run(() =>
          saveKpiSchemeAction(
            {
              name,
              description,
              entries: Object.entries(entries).map(([definitionId, c]) => ({
                definitionId,
                condition: { ...c },
              })),
              ...(initial !== undefined && duplicate !== true
                ? { familyId: initial.familyId, expectedRevision: initial.revision }
                : {}),
            },
            readCsrfToken(),
          ),
        );
      }}
    >
      <fieldset disabled={busy} className="space-y-5">
        <Field label={S.name}>
          <Input
            aria-label={S.name}
            required
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label={S.descriptionLabel}>
          <Textarea
            aria-label={S.descriptionLabel}
            maxLength={1200}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <p className="text-xs leading-relaxed text-muted-foreground">{S.schemeNote}</p>
        <div className="space-y-3">
          <h3 className="text-sm font-medium">{S.chooseKpis}</h3>
          {definitions.map((d) => {
            const condition = entries[d.id];
            return (
              <div key={d.id} className="space-y-3 rounded-lg border p-4">
                <div className="flex items-center gap-3">
                  <Checkbox
                    checked={entries[d.id] !== undefined}
                    label={d.name}
                    onCheckedChange={(checked) =>
                      setEntries((current) => {
                        const next = { ...current };
                        if (checked) next[d.id] = { kind: "at_least", target: "1" };
                        else delete next[d.id];
                        return next;
                      })
                    }
                  />
                  <span className="text-sm font-medium">{d.name}</span>
                  <span className="ms-auto text-xs text-muted-foreground">
                    {S.revision} {format.number(d.revision)}
                  </span>
                </div>
                {condition && (
                  <KpiConditionFields
                    prefix={d.name}
                    condition={condition}
                    onChange={(condition) =>
                      setEntries((current) => ({ ...current, [d.id]: condition }))
                    }
                  />
                )}
              </div>
            );
          })}
        </div>
      </fieldset>
      {Object.keys(entries).length === 0 && (
        <p className="text-xs text-muted-foreground">{S.chooseKpis}</p>
      )}
      {footer}
    </form>
  );
}

export function KpiSchemeAssignForm({
  scheme,
  users,
  teams,
  today,
  ...lifecycle
}: Lifecycle & { scheme: KpiScheme; users: Option[]; teams: Option[]; today: string }): ReactNode {
  const S = useKpiHubMessages();
  const B = useKpiMessages();
  const { locale } = useLocalePreferences();
  const deadlineRequired = scheme.entries.some((entry) => entry.condition.kind === "deadline");
  const [scope, setScope] = useState<"company" | "team" | "user">("company");
  const [scopeId, setScopeId] = useState("");
  const [choice, setChoice] = useState<keyof typeof B.periods>(
    deadlineRequired ? "custom" : "monthly",
  );
  const [startsOn, setStartsOn] = useState(today);
  const [endsOn, setEndsOn] = useState<string | null>(deadlineRequired ? today : null);
  const [fiscalStartMonth, setFiscalStartMonth] = useState(1);
  const period: KpiPeriod = {
    kind:
      choice === "custom"
        ? "one_off"
        : choice === "rolling30" || choice === "rolling90"
          ? "rolling"
          : "calendar",
    interval: ["weekly", "monthly", "quarterly", "yearly"].includes(choice)
      ? (choice as KpiPeriod["interval"])
      : "monthly",
    startsOn,
    endsOn,
    ...(choice === "rolling30"
      ? { rollingDays: 30 }
      : choice === "rolling90"
        ? { rollingDays: 90 }
        : {}),
    ...(["quarterly", "yearly"].includes(choice) ? { fiscalStartMonth } : {}),
  };
  const invalid =
    (scope !== "company" && scopeId === "") ||
    (period.kind === "one_off" && endsOn === null) ||
    (endsOn !== null && endsOn < startsOn);
  const { busy, run, footer } = useSave(lifecycle, invalid);
  return (
    <form
      className="space-y-5"
      aria-busy={busy}
      onSubmit={(e) => {
        e.preventDefault();
        void run(() =>
          applyKpiSchemeAction(
            {
              schemeId: scheme.id,
              scope,
              scopeId: scope === "company" ? null : scopeId,
              period,
              pacing: "none",
            },
            readCsrfToken(),
          ),
        );
      }}
    >
      <fieldset disabled={busy} className="space-y-4">
        <p className="text-sm text-muted-foreground">{scheme.description}</p>
        <Field label={S.scope}>
          <Select
            ariaLabel={S.scope}
            value={scope}
            onChange={(v) => {
              setScope(v as typeof scope);
              setScopeId("");
            }}
            options={["company", "team", "user"].map((v) => ({
              value: v,
              label: S[v as "company"],
            }))}
          />
        </Field>
        {scope !== "company" && (
          <Field label={S[scope]}>
            <Select
              ariaLabel={S[scope]}
              value={scopeId}
              onChange={setScopeId}
              options={[
                { value: "", label: S.choose },
                ...(scope === "team" ? teams : users).map((v) => ({ value: v.id, label: v.name })),
              ]}
            />
          </Field>
        )}
        <Field label={S.period}>
          <Select
            ariaLabel={S.period}
            value={choice}
            disabled={deadlineRequired}
            onChange={(value) => {
              setChoice(value as keyof typeof B.periods);
              if (value === "custom") setEndsOn(endsOn ?? startsOn);
            }}
            options={Object.entries(B.periods).map(([value, label]) => ({ value, label }))}
          />
        </Field>
        {["quarterly", "yearly"].includes(choice) && (
          <Field label={B.fiscalMonth}>
            <Select
              ariaLabel={B.fiscalMonth}
              value={String(fiscalStartMonth)}
              options={Array.from({ length: 12 }, (_, index) => ({
                value: String(index + 1),
                label: new Intl.DateTimeFormat(locale, {
                  month: "long",
                  calendar: "gregory",
                  timeZone: "UTC",
                }).format(new Date(Date.UTC(2026, index, 1))),
              }))}
              onChange={(value) => setFiscalStartMonth(Number(value))}
            />
            <p className="text-xs text-muted-foreground">{B.fiscalMonthHelp}</p>
          </Field>
        )}
        <Field label={S.startsOn}>
          <DatePicker
            ariaLabel={S.startsOn}
            value={startsOn}
            onChange={(v) => setStartsOn(v ?? startsOn)}
          />
        </Field>
        <Field label={S.endsOn}>
          <DatePicker
            ariaLabel={S.endsOn}
            value={endsOn}
            placeholder={B.noEnd}
            onChange={setEndsOn}
          />
        </Field>
        <p className="text-xs text-muted-foreground">{S.schemeNote}</p>
      </fieldset>
      {footer}
    </form>
  );
}

export function KpiMeasurementForm({
  row,
  today,
  ...lifecycle
}: Lifecycle & { row: KpiGoalResult; today: string }): ReactNode {
  const S = useKpiHubMessages();
  const { locale } = useLocalePreferences();
  const [value, setValue] = useState("");
  const [valueLocale, setValueLocale] = useState<Locale | null>(null);
  const [measuredOn, setMeasuredOn] = useState(today);
  const [sourceNote, setSourceNote] = useState("");
  const [sampleSize, setSampleSize] = useState("");
  const [sampleLocale, setSampleLocale] = useState<Locale | null>(null);
  const { busy, run, footer } = useSave(lifecycle);
  return (
    <form
      className="space-y-5"
      aria-busy={busy}
      onSubmit={(e) => {
        e.preventDefault();
        void run(() =>
          recordKpiMeasurementAction(
            {
              goalId: row.goal.id,
              value: normalizeNumberInput(value, valueLocale ?? locale) ?? value,
              measuredOn,
              sourceNote,
              ...(sampleSize.trim() === ""
                ? {}
                : {
                    sampleSize: Number(
                      normalizeNumberInput(sampleSize, sampleLocale ?? locale) ?? sampleSize,
                    ),
                  }),
            },
            readCsrfToken(),
          ),
        );
      }}
    >
      <fieldset disabled={busy} className="space-y-4">
        <p className="text-sm leading-relaxed text-muted-foreground">{S.manualNote}</p>
        <Field label={S.value}>
          <Input
            aria-label={S.value}
            inputMode="decimal"
            required
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setValueLocale((current) => current ?? locale);
            }}
          />
        </Field>
        <Field label={S.measuredOn}>
          <DatePicker
            ariaLabel={S.measuredOn}
            value={measuredOn}
            onChange={(v) => setMeasuredOn(v ?? measuredOn)}
          />
        </Field>
        <Field label={S.sampleSize}>
          <Input
            aria-label={S.sampleSize}
            inputMode="numeric"
            value={sampleSize}
            onChange={(e) => {
              setSampleSize(e.target.value);
              setSampleLocale((current) => current ?? locale);
            }}
          />
        </Field>
        <Field label={S.sourceNote}>
          <Textarea
            aria-label={S.sourceNote}
            required
            minLength={5}
            maxLength={1200}
            placeholder={S.sourceNotePlaceholder}
            value={sourceNote}
            onChange={(e) => setSourceNote(e.target.value)}
          />
        </Field>
        <p className="text-xs leading-relaxed text-muted-foreground">{S.manualScope}</p>
      </fieldset>
      {footer}
    </form>
  );
}

export function KpiPackForm({ pack, ...lifecycle }: Lifecycle & { pack: KpiPack }): ReactNode {
  const S = useKpiHubMessages();
  const [name, setName] = useState(pack.name);
  const [description, setDescription] = useState(pack.description);
  const { busy, run, footer } = useSave(lifecycle, pack.templates.length === 0, S.packCreate);
  return (
    <form
      className="space-y-5"
      aria-busy={busy}
      onSubmit={(event) => {
        event.preventDefault();
        void run(() =>
          createKpiPackAction(
            {
              name,
              description,
              entries: pack.templates.map((template) => ({
                definition: template.definition,
                condition: template.condition,
              })),
            },
            readCsrfToken(),
          ),
        );
      }}
    >
      <fieldset disabled={busy} className="space-y-5">
        <Field label={S.name}>
          <Input
            aria-label={S.name}
            required
            maxLength={120}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field label={S.descriptionLabel}>
          <Textarea
            aria-label={S.descriptionLabel}
            maxLength={1200}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>
        <p className="text-xs leading-relaxed text-muted-foreground">{S.packNote}</p>
        <ul className="divide-y overflow-hidden rounded-lg border">
          {pack.templates.map((template) => (
            <li key={template.id} className="space-y-2 p-4">
              <p className="text-sm font-medium">{template.name}</p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {template.description}
              </p>
              <p className="text-xs font-medium">{S.sourceDetails}</p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {template.requiredData}
              </p>
            </li>
          ))}
        </ul>
      </fieldset>
      {footer}
    </form>
  );
}
