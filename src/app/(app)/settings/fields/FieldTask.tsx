"use client";

import { useRef, useState } from "react";
import { useActionError } from "@/components/shell/ActionErrorProvider";
import type { SettingsTaskState } from "../SettingsSurface";

type TaskResult = { ok: true } | { ok: false; error: { id: string } };

export function useFieldTask() {
  const reportError = useActionError();
  const busy = useRef(false);
  const [state, setState] = useState<SettingsTaskState>("idle");

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
