"use client";

import { type FormEvent, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { ERROR_IDS } from "@/constants/errorIds";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { useFormatters } from "@/lib/useFormatters";
import { readCsrfToken } from "@/utils/csrfCookie";
import { submitWorkflowHumanFormAction } from "../actions";
import { type WorkflowHumanFormField, workflowHumanFormLimits } from "../workflowHumanFormContract";
import type { PendingWorkflowHumanForm } from "../workflowHumanFormPending";

interface Command {
  workflowId: string;
  runId: string;
  nodeId: string;
  requestKey: string;
  answers: Record<string, string | number | null>;
}

type State = "idle" | "pending" | "submitted" | "unknown" | "rejected";

function answerFor(data: FormData, field: WorkflowHumanFormField) {
  const value = data.get(field.id);
  if (typeof value !== "string" || value.trim() === "") return null;
  return field.type === "number" ? Number(value) : value;
}

export function RunHumanForm({
  form,
  workflowId,
  runId,
  onSubmitted,
  unavailable = false,
}: {
  form: PendingWorkflowHumanForm;
  workflowId: string;
  runId: string;
  onSubmitted: () => void;
  unavailable?: boolean;
}) {
  const t = useAppTranslations("workflows");
  const fmt = useFormatters();
  const heading = useId();
  const [state, setState] = useState<State>("idle");
  const frozen = useRef<Command | null>(null);
  const inFlight = useRef(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (unavailable || inFlight.current || state === "submitted") return;
    const data = new FormData(event.currentTarget);
    const command = frozen.current ?? {
      workflowId,
      runId,
      nodeId: form.nodeId,
      requestKey: crypto.randomUUID(),
      answers: Object.fromEntries(form.fields.map((field) => [field.id, answerFor(data, field)])),
    };
    frozen.current = command;
    inFlight.current = true;
    setState("pending");
    try {
      const result = await submitWorkflowHumanFormAction(command, readCsrfToken());
      if (!result.ok) {
        if (result.error === ERROR_IDS.WORKFLOW_WRITE_FAILED) {
          setState("unknown");
          return;
        }
        frozen.current = null;
        setState("rejected");
        return;
      }
      setState("submitted");
      frozen.current = null;
      onSubmitted();
    } catch {
      setState("unknown");
    } finally {
      inFlight.current = false;
    }
  }
  const readOnly =
    unavailable || state === "pending" || state === "submitted" || state === "unknown";
  return (
    <section
      aria-labelledby={heading}
      className="mx-5 mb-4 space-y-3 rounded-md border p-4"
      hidden={unavailable}
    >
      <h3 id={heading} className="text-sm font-semibold">
        {t("humanFormResponse")}
      </h3>
      {form.instructions !== undefined && form.instructions !== "" && (
        <p dir="auto" className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
          {form.instructions}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        {t("humanFormDeadline", { date: fmt.dateTime(form.deadline) })}
      </p>
      <form className="space-y-3" onSubmit={(event) => void submit(event)}>
        <fieldset className="space-y-3" disabled={readOnly}>
          {form.fields.map((field) => (
            <label
              key={field.id}
              htmlFor={`${heading}-${field.id}`}
              className="block space-y-1 text-sm"
            >
              <span dir="auto">{field.label}</span>
              <Input
                id={`${heading}-${field.id}`}
                name={field.id}
                required={field.required}
                type={field.type}
                step={field.type === "number" ? "any" : undefined}
                maxLength={field.type === "text" ? workflowHumanFormLimits.text : undefined}
                placeholder={field.type === "date" ? undefined : field.placeholder}
              />
            </label>
          ))}
        </fieldset>
        {state === "rejected" && <p role="alert">{t("humanFormRejected")}</p>}
        {state === "unknown" && <p role="alert">{t("humanFormUnconfirmed")}</p>}
        {state === "submitted" && <p role="status">{t("humanFormSubmitted")}</p>}
        <Button
          type="submit"
          disabled={unavailable || state === "pending" || state === "submitted"}
        >
          {t(state === "unknown" ? "retry" : "humanFormSubmit")}
        </Button>
      </form>
    </section>
  );
}
