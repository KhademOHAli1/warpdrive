"use client";

import { startTransition, useLayoutEffect, useRef, useState } from "react";
import { readCsrfToken } from "@/utils/csrfCookie";
import { transitionPrivacyCaseAction } from "../reviewerActions";
import { REQUEST_WAIT_MS, waitForRequest } from "./ownRequestFormModel";
import {
  emptyVerificationStart,
  type ReviewerVerificationStartError,
  type ReviewerVerificationStartIntent,
  type ReviewerVerificationStartProps,
  type ReviewerVerificationStartTask,
  type ReviewerVerificationStartView,
  verificationBoundary,
  verificationClaimKey,
  verificationDenial,
  verificationFailure,
  verificationReceipt,
  verificationRejected,
  verificationSecurityError,
} from "./reviewerVerificationStartModel";

type Operation = { controller: AbortController; epoch: number; parentDenialEpoch: number };
export function useReviewerVerificationStart(
  props: ReviewerVerificationStartProps,
): ReviewerVerificationStartTask {
  const [reviewerId] = useState(props.securityStatus.user.id);
  const boundary = verificationBoundary(props);
  const [view, setView] = useState(() =>
    emptyVerificationStart(boundary, props.parentDenial.epoch),
  );
  const active = useRef<Operation | null>(null);
  const status = props.securityStatus;
  const unavailable = props.securityUnavailable === true;
  const securityError = verificationSecurityError(status, reviewerId, unavailable);
  const claimKey = verificationClaimKey(props);
  const parentDenialEpoch = props.parentDenial.epoch;
  const parentDenied = view.parentDenialEpoch !== parentDenialEpoch;

  if (view.boundary !== boundary) {
    setView((previous) => ({
      ...previous,
      boundary,
      parentDenialEpoch,
      ...(securityError === null && !parentDenied
        ? {}
        : {
            epoch: previous.epoch + 1,
            receipt: null,
            busy: false,
            phase: previous.phase === "pending" ? "uncertain" : previous.phase,
            error: previous.phase === "idle" ? null : (securityError ?? props.parentDenial.reason),
            blocked: status.user.id !== reviewerId ? "account_changed" : previous.blocked,
          }),
    }));
  }
  useLayoutEffect(() => {
    if (
      status.user.id !== reviewerId ||
      unavailable ||
      !status.emailVerified ||
      !status.fresh ||
      status.needsMfa ||
      status.needsEnrollment ||
      (active.current !== null && active.current.parentDenialEpoch !== parentDenialEpoch)
    ) {
      active.current?.controller.abort();
      active.current = null;
    }
  }, [
    parentDenialEpoch,
    reviewerId,
    status.user.id,
    status.emailVerified,
    status.fresh,
    status.needsMfa,
    status.needsEnrollment,
    unavailable,
  ]);
  useLayoutEffect(
    () => () => {
      active.current?.controller.abort();
      active.current = null;
    },
    [],
  );

  const blocked = view.blocked !== null || status.user.id !== reviewerId;
  function run(intent: ReviewerVerificationStartIntent) {
    if (active.current !== null || blocked || unavailable) return;
    const operation = { controller: new AbortController(), epoch: view.epoch, parentDenialEpoch };
    active.current = operation;
    const signal = AbortSignal.any([
      operation.controller.signal,
      AbortSignal.timeout(REQUEST_WAIT_MS),
    ]);
    const current = () => active.current === operation && !operation.controller.signal.aborted;
    const update = (patch: Partial<ReviewerVerificationStartView>) => {
      if (current())
        setView((previous) =>
          previous.epoch === operation.epoch ? { ...previous, ...patch } : previous,
        );
    };
    const fail = (error: ReviewerVerificationStartError, rejected = false) => {
      const denial = verificationDenial(error);
      if (denial !== null) props.onDeny?.(denial);
      update({ phase: rejected ? "rejected" : "uncertain", receipt: null, error });
    };
    const invalidate = (reason: "account_changed" | "signed_out") => {
      props.onInvalidate?.(reason);
      update({ blocked: reason, receipt: null, error: "reviewer_changed", phase: "uncertain" });
    };
    const acceptTransitionOutcome = (
      result: Awaited<ReturnType<typeof transitionPrivacyCaseAction>>,
    ) => {
      if (!result.ok) {
        const error = verificationFailure(result.error);
        if (error === "reviewer_changed") invalidate("account_changed");
        else fail(error, verificationRejected(error));
        return;
      }
      const receipt = verificationReceipt(result.value, intent);
      if (receipt === null) {
        fail("request_failed");
        return;
      }
      update({ intent: null, receipt, phase: "recorded", error: null });
    };
    setView((previous) => ({
      ...previous,
      intent,
      receipt: null,
      busy: true,
      phase: "pending",
      error: null,
    }));
    startTransition(async () => {
      try {
        const refreshed = await waitForRequest(props.refreshSecurity(signal), signal);
        signal.throwIfAborted();
        if (!current()) return;
        if (!refreshed.ok) {
          fail("security_unavailable");
          return;
        }
        if (refreshed.value === null) {
          invalidate("signed_out");
          return;
        }
        if (refreshed.value.user.id !== reviewerId) {
          invalidate("account_changed");
          return;
        }
        const denied = verificationSecurityError(refreshed.value, reviewerId);
        if (denied !== null) {
          fail(denied);
          return;
        }
        const result = await waitForRequest(
          transitionPrivacyCaseAction(readCsrfToken(), intent, reviewerId),
          signal,
        );
        signal.throwIfAborted();
        if (!current()) return;
        acceptTransitionOutcome(result);
      } catch (cause) {
        if (current())
          fail(
            cause instanceof DOMException && cause.name === "AbortError"
              ? "transport_interrupted"
              : "request_failed",
          );
      } finally {
        if (current()) {
          update({ busy: false });
          active.current = null;
        }
      }
    });
  }
  const canStart =
    claimKey !== null &&
    claimKey !== view.consumedClaim &&
    view.intent === null &&
    !blocked &&
    !unavailable;
  const canRetry =
    view.intent !== null &&
    ["prepared", "uncertain"].includes(view.phase) &&
    !blocked &&
    !unavailable;
  return {
    ...view,
    receipt: securityError === null && !blocked && !parentDenied ? view.receipt : null,
    canStart: canStart && !view.busy,
    canRetry: canRetry && !view.busy,
    canClear: view.intent !== null && !view.busy && !blocked,
    locksClaim: view.intent !== null,
    start: () => {
      const receipt = props.claimReceipt;
      if (!canStart || active.current !== null || receipt === null) return;
      const intent = Object.freeze({
        caseId: receipt.id,
        expectedVersion: receipt.version,
        commandId: crypto.randomUUID(),
        toStatus: "verification_needed" as const,
      });
      setView((previous) => ({ ...previous, consumedClaim: claimKey }));
      run(intent);
    },
    retry: () => {
      if (canRetry && view.intent !== null) run(view.intent);
    },
    clear: () => {
      if (active.current !== null || view.busy || blocked) return;
      setView((previous) => ({
        ...previous,
        intent: null,
        receipt: null,
        error: null,
        phase: "idle",
      }));
    },
  };
}
