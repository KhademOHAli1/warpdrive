"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Button } from "@/components/ui/Button";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { mailboxConnectionMessages } from "./messages";
import type { MailboxConnectionError, MailboxConnectionResult } from "./types";

export function useMailboxConnectionTask() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MailboxConnectionError | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const run = useCallback(
    async <T,>(
      action: (signal: AbortSignal) => Promise<MailboxConnectionResult<T>>,
      success: (value: T) => void,
    ): Promise<void> => {
      controller.current?.abort();
      const current = new AbortController();
      controller.current = current;
      setBusy(true);
      setError(null);
      try {
        const result = await action(current.signal);
        if (current.signal.aborted) return;
        if (!result.ok) {
          setError(result.error);
          return;
        }
        success(result.value);
      } catch {
        if (!current.signal.aborted) setError("network");
      } finally {
        if (!current.signal.aborted) setBusy(false);
      }
    },
    [],
  );
  return { busy, error, run };
}

export function MailboxConnectionFeedback({
  error,
  onRequireFreshAuth,
  onBeforeFreshAuth,
}: {
  error: MailboxConnectionError | null;
  onRequireFreshAuth?: () => void;
  onBeforeFreshAuth?: () => void;
}) {
  const L = mailboxConnectionMessages(useLocale());
  if (error === null) return null;
  function prepareConfirmation() {
    // Commit secret clearing before the caller can navigate or open another security surface.
    if (onBeforeFreshAuth !== undefined) flushSync(onBeforeFreshAuth);
  }
  return (
    <div className="space-y-2">
      <p role="alert" className="text-sm leading-relaxed text-destructive">
        {L.errors[error]}
      </p>
      {error === "fresh_auth_required" &&
        (onRequireFreshAuth !== undefined ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              prepareConfirmation();
              onRequireFreshAuth();
            }}
          >
            {L.confirmIdentity}
          </Button>
        ) : (
          <a
            className="text-sm text-action underline-offset-4 hover:underline"
            href="/settings/security?returnTo=%2Fsettings%2Femail-sync"
            onClick={prepareConfirmation}
          >
            {L.confirmIdentity}
          </a>
        ))}
    </div>
  );
}
