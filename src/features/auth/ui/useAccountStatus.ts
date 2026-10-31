"use client";
import { useCallback, useEffect, useReducer, useState } from "react";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { authScreensMessagesForLocale } from "../authScreensMessages";
import type { AuthProviders, SecurityStatus } from "../better/contracts";
import { authErrorMessage } from "./authUiModel";
import { providersSchema, statusSchema, workflowRequest } from "./workflowRequest";

export function useAccountStatus(initial?: SecurityStatus) {
  const L = authScreensMessagesForLocale(useLocale()).flow;
  const [status, setStatus] = useState(initial ?? null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(
    async (signal: AbortSignal) => {
      try {
        const result = await workflowRequest("status", statusSchema, signal);
        if (signal.aborted) return;
        if (result.ok) {
          setStatus(result.data);
          setError(null);
        } else {
          setStatus(null);
          setError(authErrorMessage(result.error, L));
        }
      } catch {
        if (!signal.aborted) setError(L.networkError);
      }
    },
    [L],
  );
  useEffect(() => {
    const c = new AbortController();
    void Promise.resolve().then(() => {
      if (!c.signal.aborted) return refresh(c.signal);
    });
    return () => c.abort();
  }, [refresh]);
  return { status, error, refresh };
}

export function useAuthProviders(initial?: AuthProviders) {
  const [attempt, retry] = useReducer((value: number) => value + 1, 0);
  const [config, setConfig] = useState<AuthProviders | null>(initial ?? null);
  const [error, setError] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the retry counter explicitly reruns the same provider request.
  useEffect(() => {
    if (initial) return;
    const c = new AbortController();
    void workflowRequest("providers", providersSchema, c.signal)
      .then((result) => {
        if (!c.signal.aborted) {
          if (result.ok) {
            setConfig(result.data);
            setError(false);
          } else setError(true);
        }
      })
      .catch(() => {
        if (!c.signal.aborted) setError(true);
      });
    return () => c.abort();
  }, [initial, attempt]);
  return { config, error, retry };
}
