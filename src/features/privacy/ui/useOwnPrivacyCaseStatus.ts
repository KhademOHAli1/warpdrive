"use client";

import { startTransition, useCallback, useLayoutEffect, useRef, useState } from "react";
import { readCsrfToken } from "@/utils/csrfCookie";
import { readOwnPrivacyRequestAction, verifyOwnPrivacyRequestAction } from "../requestActions";
import {
  canConfirmOwnCase,
  emptyOwnCase,
  type OwnCaseFailure,
  type OwnPrivacyCaseStatusProps,
} from "./ownCaseStatusModel";
import { REQUEST_WAIT_MS, waitForRequest } from "./ownRequestFormModel";

export function useOwnPrivacyCaseStatus(props: OwnPrivacyCaseStatusProps) {
  const { refreshSecurity } = props;
  const [requesterId] = useState(props.securityStatus.user.id);
  const [blocked, setBlocked] = useState<"account_changed" | "signed_out" | null>(null);
  const [view, setView] = useState(() =>
    emptyOwnCase(props.caseId, props.securityStatus.fresh, props.securityStatus.emailVerified),
  );
  const active = useRef<AbortController | null>(null);
  const running = useRef(false);
  const security = useRef(props.securityStatus);
  const changed = props.securityStatus.user.id !== requesterId;
  const emailVerified = props.securityStatus.emailVerified;
  const [previousEmailVerified, setPreviousEmailVerified] = useState(emailVerified);

  if (changed && blocked !== "account_changed") {
    setBlocked("account_changed");
    setView(emptyOwnCase(props.caseId, false));
  } else if (view.caseId !== props.caseId) {
    setView(emptyOwnCase(props.caseId, props.securityStatus.fresh, emailVerified));
  }
  if (previousEmailVerified !== emailVerified) {
    setPreviousEmailVerified(emailVerified);
    // Keep an uncertain confirmation's exact command; its prior data and notice are private cache.
    if (!emailVerified)
      setView((previous) => ({
        ...previous,
        data: null,
        recorded: false,
        busy: false,
        error: "email_verification_required",
      }));
  }
  useLayoutEffect(() => {
    security.current = props.securityStatus;
    if (changed || !emailVerified) {
      active.current?.abort();
      active.current = null;
      running.current = false;
    }
  }, [changed, emailVerified, props.securityStatus]);

  const invalidate = useCallback(
    (reason: "account_changed" | "signed_out") => {
      active.current?.abort();
      active.current = null;
      running.current = false;
      setBlocked(reason);
      setView(emptyOwnCase(props.caseId, false));
    },
    [props.caseId],
  );
  const failure = useCallback((error: OwnCaseFailure) => {
    setView((previous) => ({
      ...previous,
      error,
      data:
        error === "forbidden" ||
        error === "not_found" ||
        error === "fresh_auth_required" ||
        error === "email_verification_required"
          ? null
          : previous.data,
      recorded: error === "email_verification_required" ? false : previous.recorded,
    }));
  }, []);
  const read = useCallback(
    async (signal: AbortSignal) => {
      signal.throwIfAborted();
      const result = await waitForRequest(
        readOwnPrivacyRequestAction(readCsrfToken(), { caseId: props.caseId }),
        signal,
      );
      signal.throwIfAborted();
      if (!result.ok) {
        failure(result.error);
        return;
      }
      setView((previous) => ({ ...previous, data: result.value, error: null }));
    },
    [failure, props.caseId],
  );
  const run = useCallback(
    (task: (signal: AbortSignal) => Promise<void>, supersede = false) => {
      if (changed || blocked !== null || (running.current && !supersede)) return;
      active.current?.abort();
      const controller = new AbortController();
      active.current = controller;
      running.current = true;
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(REQUEST_WAIT_MS)]);
      setView((previous) => ({ ...previous, busy: true, error: null }));
      startTransition(async () => {
        try {
          await task(signal);
        } catch (cause) {
          if (!controller.signal.aborted)
            failure(
              typeof cause === "object" &&
                cause !== null &&
                "name" in cause &&
                cause.name === "AbortError"
                ? "transport_interrupted"
                : "request_failed",
            );
        } finally {
          if (active.current === controller) {
            running.current = false;
            setView((previous) => ({ ...previous, busy: false }));
          }
        }
      });
    },
    [blocked, changed, failure],
  );

  useLayoutEffect(() => {
    const initial = new AbortController();
    void Promise.resolve().then(() => {
      if (initial.signal.aborted || blocked !== null || changed) return;
      if (!security.current.emailVerified) failure("email_verification_required");
      else if (security.current.fresh) run(read, true);
      else failure("fresh_auth_required");
    });
    return () => {
      initial.abort();
      active.current?.abort();
      active.current = null;
      running.current = false;
    };
  }, [blocked, changed, failure, read, run]);

  const checkIdentity = useCallback(
    async (signal: AbortSignal) => {
      const result = await waitForRequest(refreshSecurity(signal), signal);
      signal.throwIfAborted();
      if (!result.ok) {
        failure("request_failed");
        return false;
      }
      if (result.value === null || result.value.user.id !== requesterId) {
        invalidate(result.value === null ? "signed_out" : "account_changed");
        return false;
      }
      if (!result.value.emailVerified) {
        failure("email_verification_required");
        return false;
      }
      if (!result.value.fresh) {
        failure("fresh_auth_required");
        return false;
      }
      setView((previous) => ({ ...previous, error: null }));
      return true;
    },
    [failure, invalidate, refreshSecurity, requesterId],
  );
  function refresh() {
    run(async (signal) => {
      if (await checkIdentity(signal)) await read(signal);
    });
  }
  function confirm() {
    if (
      running.current ||
      changed ||
      blocked !== null ||
      view.recorded ||
      view.data === null ||
      (view.command === null && !canConfirmOwnCase(view.data.status))
    )
      return;
    const command = view.command ?? {
      caseId: props.caseId,
      expectedVersion: view.data.version,
      commandId: crypto.randomUUID(),
    };
    setView((previous) => ({ ...previous, command }));
    run(async (signal) => {
      if (!(await checkIdentity(signal))) return;
      signal.throwIfAborted();
      const result = await waitForRequest(
        verifyOwnPrivacyRequestAction(readCsrfToken(), command),
        signal,
      );
      signal.throwIfAborted();
      if (!result.ok) {
        failure(result.error);
        if (["stale_version", "case_not_mutable", "invalid_input"].includes(result.error))
          setView((previous) => ({ ...previous, command: null }));
        return;
      }
      // A matching command receipt may be historical. Only a fresh read supplies current state.
      setView((previous) => ({ ...previous, recorded: true, error: null }));
      await read(signal);
    });
  }
  // Exact command replay remains valid after an operator advances or closes the case.
  const canConfirm =
    view.data !== null &&
    (view.command !== null || canConfirmOwnCase(view.data.status)) &&
    !view.recorded &&
    !["stale_version", "case_not_mutable", "idempotency_conflict"].includes(view.error ?? "");
  const needsEmailVerification = !emailVerified || view.error === "email_verification_required";
  return {
    ...view,
    data:
      view.caseId === props.caseId && !changed && blocked === null && !needsEmailVerification
        ? view.data
        : null,
    recorded: !needsEmailVerification && view.recorded,
    blocked: changed ? ("account_changed" as const) : blocked,
    canConfirm: !needsEmailVerification && canConfirm,
    refresh,
    confirm,
    confirmFreshIdentity: () =>
      run(async (signal) => {
        await checkIdentity(signal);
      }),
  };
}
