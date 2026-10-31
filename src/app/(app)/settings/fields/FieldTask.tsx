"use client";

import { useRef, useState } from "react";
import { useActionError } from "@/components/shell/ActionErrorProvider";
import { useSettingsMessages } from "@/features/identity/useSettingsMessages";

type TaskResult = { ok: true } | { ok: false; error: { id: string } };
type TaskState = "idle" | "saving" | "saved" | "error";

export function useFieldTask() {
  const reportError = useActionError();
  const busy = useRef(false);
  const [state, setState] = useState<TaskState>("idle");

  async function run(operation: () => Promise<TaskResult>): Promise<void> {
    if (busy.current) return;
    busy.current = true;
    setState("saving");
    try {
      const result = await operation();
      if (result.ok) setState("saved");
      else {
        setState("error");
        reportError(result.error.id);
      }
    } catch {
      setState("error");
      reportError();
    } finally {
      busy.current = false;
    }
  }

  function reset(): void {
    if (!busy.current) setState("idle");
  }

  return { run, reset, state, pending: state === "saving" };
}

export function FieldTaskStatus({ state }: { state: TaskState }) {
  const L = useSettingsMessages();
  if (state === "idle") return null;
  return (
    <p
      role={state === "error" ? "alert" : "status"}
      className={`basis-full text-xs ${state === "error" ? "text-destructive" : "text-muted-foreground"}`}
    >
      {state === "error" ? L._errors.generic : state === "saved" ? L.saved : L._extra.saving}
    </p>
  );
}
