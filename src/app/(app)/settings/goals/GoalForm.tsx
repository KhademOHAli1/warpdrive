"use client";
import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { DatePicker } from "@/components/ui/DatePicker";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import {
  ACTIVITY_ACTIONS,
  DEAL_ACTIONS,
  GOAL_INTERVALS,
  type GoalAssigneeKind,
  type GoalSubject,
} from "@/constants/goals";
import type { Goal } from "@/db/schema/goals";
import { CurrencySelect } from "@/features/currencies/CurrencySelect";
import { goalTargetInput } from "@/features/goals/goalTargetText";
import { useAppTranslations, useLocalePreferences } from "@/features/i18n/LocaleProvider";
import type { Locale } from "@/features/i18n/registry";
import { useSettingsMessages } from "@/features/identity/useSettingsMessages";
import { useFormatters } from "@/lib/useFormatters";
import { instantCivilDate } from "@/lib/zonedDateTime";
import { normalizeNumberInput } from "@/utils/normalizeNumberInput";
import { GoalFormField as Field } from "./GoalFormField";
import type { GoalDraft, Option } from "./types";

export type { GoalDraft, Option } from "./types";

const ANY = "goal:any";

interface Props {
  users: Option[];
  teams: Option[];
  pipelines: Option[];
  activityTypes: Option[];
  // Present when editing; the same form serves both so create and edit cannot drift apart.
  initial?: Goal;
  baseCurrency?: string;
  submitLabel: string;
  onSubmit: (draft: GoalDraft) => Promise<{ ok: boolean; errorId?: string }>;
  onDone: () => void;
  onCancel?: () => void;
  onBusyChange?: (busy: boolean) => void;
}

export function GoalForm({
  users,
  teams,
  pipelines,
  activityTypes,
  initial,
  baseCurrency = "USD",
  submitLabel,
  onSubmit,
  onDone,
  onCancel,
  onBusyChange,
}: Props): React.ReactElement {
  const L = useSettingsMessages();
  const S = L;
  const { locale, timeZone } = useLocalePreferences();
  const format = useFormatters();
  const sales = useAppTranslations("sales");

  const [currency, setCurrency] = useState(initial?.currency ?? baseCurrency);
  const [subject, setSubject] = useState<GoalSubject>(initial?.subject ?? "deal");
  const [action, setAction] = useState<string>(initial?.action ?? "won");
  const [metric, setMetric] = useState<string>(initial?.metric ?? "value");
  const [assigneeKind, setAssigneeKind] = useState<GoalAssigneeKind>(
    initial?.assigneeKind ?? "company",
  );
  const [assigneeId, setAssigneeId] = useState<string>(initial?.assigneeId ?? ANY);
  const [pipelineId, setPipelineId] = useState<string>(initial?.pipelineId ?? ANY);
  const [activityTypeId, setActivityTypeId] = useState<string>(initial?.activityTypeId ?? ANY);
  const [interval, setInterval] = useState<string>(initial?.interval ?? "monthly");
  const [seedTarget] = useState(initial === undefined ? "" : goalTargetInput(initial.target));
  const [targetDraft, setTargetDraft] = useState<{ raw: string; locale: Locale } | null>(null);
  const target =
    targetDraft?.raw ??
    (seedTarget === ""
      ? ""
      : format.number(seedTarget, { useGrouping: false, maximumFractionDigits: 20 }));
  const [startsOn, setStartsOn] = useState<string>(
    () => initial?.startsOn ?? instantCivilDate(new Date(), timeZone),
  );
  const [endsOn, setEndsOn] = useState<string | null>(initial?.endsOn ?? null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const busy = useRef(false);

  // Switching subject can strand an action that no longer applies, so both reset together
  // rather than letting the form submit a pair the boundary will reject.
  function chooseSubject(next: string): void {
    const s = next as GoalSubject;
    setSubject(s);
    setAction(s === "deal" ? "won" : "completed");
    if (s === "activity") setMetric("count");
  }

  const actionOptions = (subject === "deal" ? DEAL_ACTIONS : ACTIVITY_ACTIONS).map((a) => ({
    value: a,
    label: L._extra.goalActions[a],
  }));
  const assigneeOptions =
    assigneeKind === "user"
      ? users.map((u) => ({ value: u.id, label: u.name }))
      : teams.map((t) => ({ value: t.id, label: t.name }));

  function submit(e: React.FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    if (busy.current) return;
    busy.current = true;
    onBusyChange?.(true);
    setError(null);
    startTransition(async () => {
      try {
        const r = await onSubmit({
          subject,
          action,
          metric,
          assigneeKind,
          assigneeId: assigneeKind === "company" || assigneeId === ANY ? null : assigneeId,
          pipelineId: pipelineId === ANY ? null : pipelineId,
          activityTypeId: subject === "activity" && activityTypeId !== ANY ? activityTypeId : null,
          interval,
          currency,
          target:
            targetDraft === null
              ? seedTarget
              : (normalizeNumberInput(targetDraft.raw, targetDraft.locale) ??
                targetDraft.raw.trim()),
          startsOn,
          endsOn,
        });
        if (!r.ok) {
          setError(r.errorId === "E_GOAL_001" ? S.goalInvalid : S.goalSaveFailed);
          return;
        }
        onDone();
      } catch {
        setError(S.goalSaveFailed);
      } finally {
        busy.current = false;
        onBusyChange?.(false);
      }
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" aria-busy={isPending}>
      <fieldset disabled={isPending} inert={isPending} className="contents">
        {metric === "value" && (
          <Field label={sales("currencyLabel")}>
            <CurrencySelect value={currency} onChange={setCurrency} />
          </Field>
        )}
        <Field label={S.goalSubject}>
          <Select
            disabled={isPending}
            ariaLabel={S.goalSubject}
            value={subject}
            onChange={chooseSubject}
            options={[
              { value: "deal", label: L._extra.deals },
              { value: "activity", label: L._extra.activities },
            ]}
          />
        </Field>
        <Field label={S.goalAction}>
          <Select
            disabled={isPending}
            ariaLabel={S.goalAction}
            value={action}
            onChange={setAction}
            options={actionOptions}
          />
        </Field>
        <Field label={S.goalMetric}>
          <Select
            disabled={isPending}
            ariaLabel={S.goalMetric}
            value={metric}
            onChange={setMetric}
            options={
              subject === "deal"
                ? [
                    { value: "count", label: L._extra.count },
                    { value: "value", label: L._extra.value },
                  ]
                : [{ value: "count", label: L._extra.count }]
            }
          />
        </Field>
        <Field label={S.goalAssignee}>
          <Select
            disabled={isPending}
            ariaLabel={S.goalAssignee}
            value={assigneeKind}
            onChange={(v) => {
              setAssigneeKind(v as GoalAssigneeKind);
              setAssigneeId(ANY);
            }}
            options={[
              { value: "company", label: L._extra.whole_company },
              { value: "team", label: L._extra.a_team },
              { value: "user", label: L._extra.one_person },
            ]}
          />
        </Field>
        {assigneeKind !== "company" && (
          <Field label={S.goalAssignee}>
            <Select
              disabled={isPending}
              ariaLabel={S.goalAssignee}
              value={assigneeId}
              onChange={setAssigneeId}
              options={[{ value: ANY, label: L._extra.select }, ...assigneeOptions]}
            />
          </Field>
        )}
        <Field label={S.goalPipeline}>
          <Select
            disabled={isPending}
            ariaLabel={S.goalPipeline}
            value={pipelineId}
            onChange={setPipelineId}
            options={[
              { value: ANY, label: S.goalAnyPipeline },
              ...pipelines.map((p) => ({ value: p.id, label: p.name })),
            ]}
          />
        </Field>
        {subject === "activity" && (
          <Field label={S.goalActivityType}>
            <Select
              disabled={isPending}
              ariaLabel={S.goalActivityType}
              value={activityTypeId}
              onChange={setActivityTypeId}
              options={[
                { value: ANY, label: S.goalAnyActivityType },
                ...activityTypes.map((t) => ({ value: t.id, label: t.name })),
              ]}
            />
          </Field>
        )}
        <Field label={S.goalInterval}>
          <Select
            disabled={isPending}
            ariaLabel={S.goalInterval}
            value={interval}
            onChange={setInterval}
            options={GOAL_INTERVALS.map((i) => ({ value: i, label: L._extra.goalIntervals[i] }))}
          />
        </Field>
        <Field label={S.goalTarget}>
          <Input
            aria-label={S.goalTarget}
            placeholder={S.goalTarget}
            value={target}
            onChange={(e) => {
              const raw = e.target.value;
              setTargetDraft((current) => ({ raw, locale: current?.locale ?? locale }));
            }}
          />
        </Field>
        <Field label={S.goalStartsOn}>
          <DatePicker
            ariaLabel={S.goalStartsOn}
            value={startsOn}
            onChange={(v) => setStartsOn(v ?? startsOn)}
          />
        </Field>
        <Field label={S.goalEndsOn}>
          <DatePicker
            ariaLabel={S.goalEndsOn}
            value={endsOn}
            onChange={setEndsOn}
            placeholder={S.goalNoEnd}
          />
        </Field>
      </fieldset>
      <div className="flex flex-wrap justify-end gap-2 sm:col-span-2">
        {onCancel !== undefined && (
          <Button variant="outline" disabled={isPending} onClick={onCancel}>
            {L.cancel}
          </Button>
        )}
        <Button type="submit" disabled={isPending || target.trim() === ""}>
          {isPending ? L._extra.saving : submitLabel}
        </Button>
      </div>
      {error !== null && (
        <p role="alert" className="text-sm text-destructive sm:col-span-2">
          {error}
        </p>
      )}
    </form>
  );
}
