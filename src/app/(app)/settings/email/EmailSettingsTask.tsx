"use client";

import { useRef, useState } from "react";
import { useActionError } from "@/components/shell/ActionErrorProvider";
import { useSettingsMessages } from "@/features/identity/useSettingsMessages";

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

  return { pending, failed, run, reset, isPending: () => locked.current };
}

export function EmailSettingsTaskFeedback({
  pending,
  failed,
}: {
  pending: boolean;
  failed: boolean;
}) {
  const L = useSettingsMessages();
  if (pending)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {L._extra.saving}
      </p>
    );
  if (failed)
    return (
      <p role="alert" className="text-sm text-destructive">
        {L._errors.generic}
      </p>
    );
  return null;
}
