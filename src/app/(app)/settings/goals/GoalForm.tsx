"use client";
import { useState, useTransition } from "react";
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
import { useLocale } from "@/features/i18n/LocaleProvider";
import { useSettingsMessages } from "@/features/identity/useSettingsMessages";
import { normalizeNumberInput } from "@/utils/normalizeNumberInput";

const ANY = "goal:any";

export interface Option {
  id: string;
  name: string;
}

export interface GoalDraft {
  subject: string;
  action: string;
  metric: string;
  assigneeKind: string;
  assigneeId: string | null;
  pipelineId: string | null;
  activityTypeId: string | null;
  interval: string;
  target: string;
  currency?: string;
  startsOn: string;
  endsOn: string | null;
}

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
}: Props): React.ReactElement {
  const L = useSettingsMessages();
  const S = L;
  const locale = useLocale();

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
  const [target, setTarget] = useState(
    initial === undefined ? "" : goalTargetInput(initial.target),
  );
  const [startsOn, setStartsOn] = useState<string>(
    initial?.startsOn ?? new Date().toISOString().slice(0, 10),
  );
  const [endsOn, setEndsOn] = useState<string | null>(initial?.endsOn ?? null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

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
    setError(null);
    startTransition(async () => {
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
        target: normalizeNumberInput(target, locale) ?? target.trim(),
        startsOn,
        endsOn,
      });
      if (!r.ok) {
        setError(r.errorId === "E_GOAL_001" ? S.goalInvalid : S.goalSaveFailed);
        return;
      }
      onDone();
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {metric === "value" && <CurrencySelect value={currency} onChange={setCurrency} />}
      <Select
        ariaLabel={S.goalSubject}
        value={subject}
        onChange={chooseSubject}
        options={[
          { value: "deal", label: L._extra.deals },
          { value: "activity", label: L._extra.activities },
        ]}
      />
      <Select
        ariaLabel={S.goalAction}
        value={action}
        onChange={setAction}
        options={actionOptions}
      />
      <Select
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
      <Select
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
      {assigneeKind !== "company" && (
        <Select
          ariaLabel={S.goalAssignee}
          value={assigneeId}
          onChange={setAssigneeId}
          options={[{ value: ANY, label: L._extra.select }, ...assigneeOptions]}
        />
      )}
      <Select
        ariaLabel={S.goalPipeline}
        value={pipelineId}
        onChange={setPipelineId}
        options={[
          { value: ANY, label: S.goalAnyPipeline },
          ...pipelines.map((p) => ({ value: p.id, label: p.name })),
        ]}
      />
      {subject === "activity" && (
        <Select
          ariaLabel={S.goalActivityType}
          value={activityTypeId}
          onChange={setActivityTypeId}
          options={[
            { value: ANY, label: S.goalAnyActivityType },
            ...activityTypes.map((t) => ({ value: t.id, label: t.name })),
          ]}
        />
      )}
      <Select
        ariaLabel={S.goalInterval}
        value={interval}
        onChange={setInterval}
        options={GOAL_INTERVALS.map((i) => ({ value: i, label: L._extra.goalIntervals[i] }))}
      />
      <Input
        aria-label={S.goalTarget}
        placeholder={S.goalTarget}
        value={target}
        onChange={(e) => setTarget(e.target.value)}
      />
      <DatePicker
        ariaLabel={S.goalStartsOn}
        value={startsOn}
        onChange={(v) => setStartsOn(v ?? startsOn)}
      />
      <DatePicker
        ariaLabel={S.goalEndsOn}
        value={endsOn}
        onChange={setEndsOn}
        placeholder={S.goalNoEnd}
      />
      <Button type="submit" disabled={isPending || target.trim() === ""}>
        {submitLabel}
      </Button>
      {error !== null && (
        <p role="alert" className="text-sm text-destructive sm:col-span-2 lg:col-span-4">
          {error}
        </p>
      )}
    </form>
  );
}
