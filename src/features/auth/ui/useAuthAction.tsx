"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { authScreensMessagesForLocale } from "../authScreensMessages";
import { authErrorMessage } from "./authUiModel";

export interface AuthOutcome {
  error?: unknown;
  data?: unknown;
}
export function useAuthAction() {
  const L = authScreensMessagesForLocale(useLocale()).flow;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const run = useCallback(
    async (
      task: (signal: AbortSignal) => Promise<AuthOutcome>,
      success?: () => void,
    ): Promise<boolean> => {
      controller.current?.abort();
      const current = new AbortController();
      controller.current = current;
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        const result = await task(current.signal);
        if (current.signal.aborted) return false;
        if (result.error !== undefined && result.error !== null) {
          setError(authErrorMessage(result.error, L));
          return false;
        }
        success?.();
        return true;
      } catch {
        if (!current.signal.aborted) setError(L.networkError);
        return false;
      } finally {
        if (!current.signal.aborted) setBusy(false);
      }
    },
    [L],
  );
  return { busy, error, notice, setNotice, setError, run };
}

export function AuthFeedback({ error, notice }: { error: string | null; notice: string | null }) {
  const L = authScreensMessagesForLocale(useLocale()).flow;
  return (
    <>
      {error !== null && (
        <div className="space-y-2">
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
          {error === L.freshRequired && (
            <a
              href="/settings/security"
              className="inline-block text-sm text-action underline-offset-4 hover:underline"
            >
              {L.confirmIdentity}
            </a>
          )}
        </div>
      )}
      {notice !== null && (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      )}
    </>
  );
}
