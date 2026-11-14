"use client";

import { useRef, useState } from "react";
import { useActionError } from "@/components/shell/ActionErrorProvider";
import type { SettingsTaskState } from "../SettingsSurface";

type ActionResult = { ok: true } | { ok: false; error: { id: string } };

export function useEmailSettingsTask() {
  const reportError = useActionError();
  const locked = useRef(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function run(
    request: () => Promise<ActionResult>,
    onSuccess: () => void,
    onFailure?: () => void,
  ): Promise<void> {
    if (locked.current) return;
    locked.current = true;
    setPending(true);
    setFailed(false);
    try {
      const result = await request();
      if (!result.ok) {
        onFailure?.();
        setFailed(true);
        reportError(result.error.id);
      } else onSuccess();
    } catch {
      onFailure?.();
      setFailed(true);
    } finally {
      locked.current = false;
      setPending(false);
    }
  }

  function reset(): void {
    if (!locked.current) setFailed(false);
  }

  const state: SettingsTaskState = pending ? "saving" : failed ? "error" : "idle";
  return { pending, state, run, reset, isPending: () => locked.current };
}
