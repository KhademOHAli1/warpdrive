"use client";

import { useCallback, useLayoutEffect, useRef, useState, useTransition } from "react";
import type { SecurityStatus } from "@/features/auth/better/contracts";
import type { Locale } from "@/features/i18n/registry";
import type { Result } from "@/types/result";
import { readCsrfToken } from "@/utils/csrfCookie";
import { createOwnPrivacyRequestAction } from "../requestActions";
import {
  type OwnRequestError,
  type OwnRequestInput,
  type OwnRequestReceipt,
  ownRequestFormSchema,
  REQUEST_WAIT_MS,
  waitForRequest,
} from "./ownRequestFormModel";

export type OwnPrivacyRequestFormProps = {
  securityStatus: SecurityStatus;
  refreshSecurity: (signal: AbortSignal) => Promise<Result<SecurityStatus | null, "unavailable">>;
  onReceived?: (receipt: OwnRequestReceipt) => void;
};

export function useOwnPrivacyRequestForm(props: OwnPrivacyRequestFormProps, locale: Locale) {
  const [requesterId] = useState(props.securityStatus.user.id);
  const [kind, setKind] = useState<OwnRequestInput["kind"]>("access");
  const [summary, setSummary] = useState("");
  const [attempt, setAttempt] = useState<OwnRequestInput | null>(null);
  const [receipt, setReceipt] = useState<OwnRequestReceipt | null>(null);
  const [error, setError] = useState<OwnRequestError | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [busy, startTransition] = useTransition();
  const running = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const changed = props.securityStatus.user.id !== requesterId;

  const invalidate = useCallback(() => {
    controller.current?.abort();
    setSummary("");
    setKind("access");
    setAttempt(null);
    setReceipt(null);
    setError(null);
    setBlocked(true);
  }, []);
  if (changed && !blocked) {
    setSummary("");
    setKind("access");
    setAttempt(null);
    setReceipt(null);
    setError(null);
    setBlocked(true);
  }
  useLayoutEffect(() => {
    if (changed) controller.current?.abort();
  }, [changed]);
  useLayoutEffect(() => () => controller.current?.abort(), []);

  async function checkIdentity(signal: AbortSignal) {
    const refreshed = await waitForRequest(props.refreshSecurity(signal), signal);
    signal.throwIfAborted();
    if (!refreshed.ok) {
      setError("request_failed");
      return false;
    }
    const current = refreshed.value;
    if (current === null || current.user.id !== requesterId) {
      invalidate();
      return false;
    }
    if (!current.fresh) {
      setError("fresh_auth_required");
      return false;
    }
    setError(null);
    return true;
  }

  function run(task: (signal: AbortSignal) => Promise<OwnRequestReceipt | undefined>) {
    if (running.current || blocked || changed) return;
    running.current = true;
    const active = new AbortController();
    controller.current = active;
    const signal = AbortSignal.any([active.signal, AbortSignal.timeout(REQUEST_WAIT_MS)]);
    startTransition(async () => {
      let accepted: OwnRequestReceipt | undefined;
      try {
        accepted = await task(signal);
      } catch (cause) {
        if (!active.signal.aborted)
          setError(
            typeof cause === "object" &&
              cause !== null &&
              "name" in cause &&
              cause.name === "AbortError"
              ? "transport_interrupted"
              : "request_failed",
          );
      } finally {
        running.current = false;
      }
      if (accepted !== undefined && !active.signal.aborted) props.onReceived?.(accepted);
    });
  }

  function submit() {
    if (running.current || blocked || changed || receipt !== null) return;
    const isRetry = attempt !== null;
    const candidate = attempt ?? {
      intakeKey: crypto.randomUUID(),
      kind,
      locale,
      summary,
    };
    const parsed = ownRequestFormSchema.safeParse(candidate);
    if (!parsed.success) {
      setError("invalid_input");
      return;
    }
    const intent = parsed.data;
    setAttempt(intent);
    setError(null);
    run(async (signal) => {
      if (isRetry && !(await checkIdentity(signal))) return;
      signal.throwIfAborted();
      const result = await waitForRequest(
        createOwnPrivacyRequestAction(readCsrfToken(), intent, requesterId),
        signal,
      );
      signal.throwIfAborted();
      if (result.ok) {
        setReceipt(result.value);
        return result.value;
      }
      if (result.error === "requester_changed") {
        invalidate();
        return;
      }
      setError(result.error);
      if (result.error === "invalid_input") setAttempt(null);
    });
  }

  function confirmIdentity() {
    run(async (signal) => {
      await checkIdentity(signal);
      return undefined;
    });
  }

  return {
    kind,
    setKind,
    summary,
    setSummary,
    receipt,
    error,
    blocked: blocked || changed,
    frozen: attempt !== null,
    busy,
    submit,
    confirmIdentity,
  };
}
