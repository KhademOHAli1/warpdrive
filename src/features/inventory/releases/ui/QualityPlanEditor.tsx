"use client";

import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { maxQualityPlanSteps, type QualityStepDraft } from "../../quality/contracts";
import { qualityPlanMessages } from "./qualityPlanMessages";

type EditableStep = {
  key: string;
  label: string;
  evidenceRequired: boolean;
  kind: QualityStepDraft["kind"];
  unit: string;
  minimum: string;
  maximum: string;
};

function blankStep(): EditableStep {
  return {
    key: crypto.randomUUID(),
    label: "",
    evidenceRequired: false,
    kind: "measurement",
    unit: "",
    minimum: "",
    maximum: "",
  };
}

function toEditableStep(step: QualityStepDraft): EditableStep {
  if (step.kind === "check") return { ...step, unit: "", minimum: "", maximum: "" };
  return {
    ...step,
    minimum: step.minimum === null ? "" : String(step.minimum),
    maximum: step.maximum === null ? "" : String(step.maximum),
  };
}

function toQualityStep(step: EditableStep): QualityStepDraft | null {
  const label = step.label.trim();
  if (label === "") return null;
  const { key, evidenceRequired } = step;
  if (step.kind === "check") return { key, label, kind: "check", evidenceRequired };

  const unit = step.unit.trim();
  const minimum = step.minimum === "" ? null : Number(step.minimum);
  const maximum = step.maximum === "" ? null : Number(step.maximum);
  if (unit === "" || (minimum === null && maximum === null)) return null;
  if (minimum !== null && !Number.isFinite(minimum)) return null;
  if (maximum !== null && !Number.isFinite(maximum)) return null;
  if (minimum !== null && maximum !== null && minimum > maximum) return null;
  return { key, label, evidenceRequired, kind: "measurement", unit, minimum, maximum };
}

const fieldClass = "grid min-w-0 gap-1 text-xs font-medium";

function focusPlanName(field: HTMLInputElement | null) {
  field?.focus();
}

function QualityStepFields({
  step,
  number,
  pending,
  update,
  remove,
}: {
  step: EditableStep;
  number: string;
  pending: boolean;
  update: (change: Partial<EditableStep>) => void;
  remove?: () => void;
}) {
  const t = qualityPlanMessages[useLocale()];
  const id = useId();
  const boundsId = `${id}-bounds`;
  const boundsReversed =
    step.minimum !== "" && step.maximum !== "" && Number(step.minimum) > Number(step.maximum);
  return (
    <fieldset className="min-w-0 space-y-2 rounded-md border px-3 pb-3" disabled={pending}>
      <legend className="px-1 text-xs font-semibold">{t.stepNumber(number)}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        <label htmlFor={`${id}-name`} className={fieldClass}>
          {t.stepName}
          <Input
            id={`${id}-name`}
            value={step.label}
            onChange={(event) => update({ label: event.currentTarget.value })}
            maxLength={120}
            required
          />
        </label>
        <div className={fieldClass}>
          <span>{t.stepKind}</span>
          <Select
            value={step.kind}
            onChange={(kind) => update({ kind: kind === "check" ? "check" : "measurement" })}
            options={[
              { value: "measurement", label: t.measurement },
              { value: "check", label: t.check },
            ]}
            ariaLabel={t.stepKind}
            contentClassName={`${BLOCK_CLASS} ph-no-capture`}
            disabled={pending}
          />
        </div>
      </div>
      {step.kind === "measurement" && (
        <div className="space-y-1">
          <div className="grid gap-2 sm:grid-cols-3">
            <label htmlFor={`${id}-unit`} className={fieldClass}>
              {t.unit}
              <Input
                id={`${id}-unit`}
                value={step.unit}
                onChange={(event) => update({ unit: event.currentTarget.value })}
                maxLength={32}
                required
              />
            </label>
            {(["minimum", "maximum"] as const).map((bound) => (
              <label key={bound} htmlFor={`${id}-${bound}`} className={fieldClass}>
                {t[bound]}
                <Input
                  id={`${id}-${bound}`}
                  type="number"
                  step="any"
                  value={step[bound]}
                  onChange={(event) => update({ [bound]: event.currentTarget.value })}
                  aria-describedby={boundsId}
                  aria-invalid={boundsReversed || undefined}
                />
              </label>
            ))}
          </div>
          <p
            id={boundsId}
            className={
              boundsReversed ? "text-xs text-destructive" : "text-xs text-muted-foreground"
            }
          >
            {boundsReversed ? t.limitOrder : t.limitHelp}
          </p>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Checkbox
            id={`${id}-evidence`}
            label={t.evidence}
            checked={step.evidenceRequired}
            onCheckedChange={(evidenceRequired) => update({ evidenceRequired })}
            disabled={pending}
          />
          <label htmlFor={`${id}-evidence`} className="text-sm">
            {t.evidence}
          </label>
        </div>
        {remove && (
          <Button type="button" variant="ghost" size="sm" onClick={remove}>
            {t.removeStep(number)}
          </Button>
        )}
      </div>
    </fieldset>
  );
}

export function QualityPlanEditor({
  initial,
  pending,
  create,
}: {
  initial: { name: string; steps: QualityStepDraft[] } | undefined;
  pending: boolean;
  create: (name: string, steps: QualityStepDraft[], requestId: string) => Promise<boolean>;
}) {
  const t = qualityPlanMessages[useLocale()];
  const nameId = useId();
  const request = useRef<{ id: string; payload: string }>(null);
  const [name, setName] = useState("");
  const [steps, setSteps] = useState<EditableStep[] | null>(null);
  if (steps === null) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => {
          request.current = null;
          setName(initial?.name ?? "");
          setSteps(initial === undefined ? [blankStep()] : initial.steps.map(toEditableStep));
        }}
      >
        {t.create}
      </Button>
    );
  }

  const draftedSteps = steps.map(toQualityStep);
  return (
    <form
      data-quality-plan-editor
      className="space-y-3 rounded-md border bg-card p-3"
      onSubmit={(event) => {
        event.preventDefault();
        const planName = name.trim();
        if (pending || planName === "" || !draftedSteps.every((step) => step !== null)) return;
        const payload = JSON.stringify({ name: planName, steps: draftedSteps });
        if (request.current?.payload !== payload)
          request.current = { id: crypto.randomUUID(), payload };
        void create(planName, draftedSteps, request.current.id).then((saved) => {
          if (saved) setSteps(null);
        });
      }}
    >
      <label htmlFor={nameId} className={fieldClass}>
        {t.name}
        <Input
          id={nameId}
          ref={focusPlanName}
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
          maxLength={100}
          required
          disabled={pending}
        />
      </label>
      {steps.map((step, index) => (
        <QualityStepFields
          key={step.key}
          step={step}
          number={String(index + 1)}
          pending={pending}
          update={(change) =>
            setSteps(
              steps.map((candidate) =>
                candidate.key === step.key ? { ...step, ...change } : candidate,
              ),
            )
          }
          remove={
            steps.length > 1
              ? () => setSteps(steps.filter(({ key }) => key !== step.key))
              : undefined
          }
        />
      ))}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending || steps.length >= maxQualityPlanSteps}
          onClick={() => setSteps([...steps, blankStep()])}
        >
          {t.addStep}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => setSteps(null)}
        >
          {t.cancel}
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={pending || name.trim() === "" || draftedSteps.some((step) => step === null)}
        >
          {t.save}
        </Button>
      </div>
    </form>
  );
}
