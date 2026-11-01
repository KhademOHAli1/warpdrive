"use client";

import { startTransition, useCallback, useLayoutEffect, useRef, useState } from "react";
import { readCsrfToken } from "@/utils/csrfCookie";
import { claimPrivacyCaseAction, listPrivacyIntakeQueueAction } from "../reviewerActions";
import { REQUEST_WAIT_MS, waitForRequest } from "./ownRequestFormModel";
import {
  emptyReviewerIntake,
  hideQueueForFailure,
  isDefinitiveClaimFailure,
  type ReviewerClaimIntent,
  type ReviewerIntakeCardProps,
  type ReviewerIntakeError,
  type ReviewerIntakeRow,
  type ReviewerIntakeView,
  reviewerIsFresh,
} from "./reviewerIntakeModel";

const QUEUE_PAGE_SIZE = 25;
export function useReviewerIntake(props: ReviewerIntakeCardProps) {
  const { refreshSecurity } = props;
  const [reviewerId] = useState(props.securityStatus.user.id);
  const [view, setView] = useState<ReviewerIntakeView>(emptyReviewerIntake);
  const [blocked, setBlocked] = useState<"account_changed" | "signed_out" | null>(null);
  const active = useRef<AbortController | null>(null);
  const running = useRef(false);
  const changed = props.securityStatus.user.id !== reviewerId;
  const unavailable = props.securityUnavailable === true;
  const fresh = reviewerIsFresh(props.securityStatus);
  const securityBoundary = `${props.securityStatus.user.id}:${unavailable}:${fresh}`;
  const [previousBoundary, setPreviousBoundary] = useState(securityBoundary);

  // Clear cached disclosure before committing a changed security boundary.
  if (previousBoundary !== securityBoundary) {
    setPreviousBoundary(securityBoundary);
    if (changed) setBlocked("account_changed");
    if (changed || unavailable || !fresh) {
      setView((previous) => ({
        ...previous,
        rows: [],
        cursor: null,
        receipt: null,
        loaded: false,
        busy: false,
        claimState: previous.claimState === "pending" ? "uncertain" : previous.claimState,
        error: previous.engaged
          ? unavailable
            ? "security_unavailable"
            : "fresh_auth_required"
          : null,
      }));
    }
  }

  const fail = useCallback((error: ReviewerIntakeError, mutation = false) => {
    setView((previous) => ({
      ...previous,
      error,
      rows: hideQueueForFailure(error) ? [] : previous.rows,
      cursor: hideQueueForFailure(error) ? null : previous.cursor,
      loaded: hideQueueForFailure(error) ? false : previous.loaded,
      receipt: hideQueueForFailure(error) ? null : previous.receipt,
      claimState: mutation
        ? isDefinitiveClaimFailure(error)
          ? "rejected"
          : "uncertain"
        : previous.claimState,
    }));
    if (error === "reviewer_changed") setBlocked("account_changed");
  }, []);
  const invalidate = useCallback((reason: "account_changed" | "signed_out") => {
    active.current?.abort();
    active.current = null;
    running.current = false;
    setBlocked(reason);
    setView((previous) => ({ ...previous, rows: [], cursor: null, receipt: null, busy: false }));
  }, []);

  useLayoutEffect(() => {
    if (changed || unavailable || !fresh) {
      active.current?.abort();
      active.current = null;
      running.current = false;
    }
  }, [changed, fresh, unavailable]);
  useLayoutEffect(
    () => () => {
      active.current?.abort();
      active.current = null;
      running.current = false;
    },
    [],
  );

  const checkIdentity = useCallback(
    async (signal: AbortSignal) => {
      const current = await waitForRequest(refreshSecurity(signal), signal);
      signal.throwIfAborted();
      if (!current.ok) {
        fail("security_unavailable");
        return false;
      }
      if (current.value === null || current.value.user.id !== reviewerId) {
        invalidate(current.value === null ? "signed_out" : "account_changed");
        return false;
      }
      if (!reviewerIsFresh(current.value)) {
        fail("fresh_auth_required");
        return false;
      }
      return true;
    },
    [fail, invalidate, refreshSecurity, reviewerId],
  );

  const run = useCallback(
    (task: (signal: AbortSignal) => Promise<void>) => {
      if (changed || blocked !== null || unavailable || running.current) return;
      const controller = new AbortController();
      active.current = controller;
      running.current = true;
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(REQUEST_WAIT_MS)]);
      setView((previous) => ({ ...previous, busy: true, engaged: true, error: null }));
      startTransition(async () => {
        try {
          await task(signal);
        } catch (cause) {
          if (!controller.signal.aborted) {
            const interrupted =
              typeof cause === "object" &&
              cause !== null &&
              "name" in cause &&
              cause.name === "AbortError";
            setView((previous) => ({
              ...previous,
              error: interrupted ? "transport_interrupted" : "request_failed",
              claimState: previous.claimState === "pending" ? "uncertain" : previous.claimState,
            }));
          }
        } finally {
          if (active.current === controller) {
            active.current = null;
            running.current = false;
            setView((previous) => ({ ...previous, busy: false }));
          }
        }
      });
    },
    [blocked, changed, unavailable],
  );

  function read(append: boolean) {
    const cursor = append ? view.cursor : null;
    if (append && cursor === null) return;
    run(async (signal) => {
      if (!(await checkIdentity(signal))) return;
      const result = await waitForRequest(
        listPrivacyIntakeQueueAction(
          readCsrfToken(),
          cursor === null
            ? { limit: QUEUE_PAGE_SIZE }
            : { limit: QUEUE_PAGE_SIZE, afterId: cursor },
          reviewerId,
        ),
        signal,
      );
      signal.throwIfAborted();
      if (!result.ok) {
        fail(result.error);
        return;
      }
      setView((previous) => {
        const resolved = !append && ["recorded", "rejected"].includes(previous.claimState);
        const rows = new Map((append ? previous.rows : []).map((row) => [row.id, row]));
        for (const row of result.value.items) rows.set(row.id, row);
        return {
          ...previous,
          rows: [...rows.values()],
          cursor: result.value.nextAfterId,
          loaded: true,
          error: null,
          intent: resolved ? null : previous.intent,
          claimState: resolved ? "idle" : previous.claimState,
          receipt: resolved ? null : previous.receipt,
        };
      });
    });
  }
  function submit(intent: ReviewerClaimIntent) {
    run(async (signal) => {
      if (!(await checkIdentity(signal))) return;
      setView((previous) => ({ ...previous, claimState: "pending" }));
      const result = await waitForRequest(
        claimPrivacyCaseAction(readCsrfToken(), intent, reviewerId),
        signal,
      );
      signal.throwIfAborted();
      if (!result.ok) {
        fail(result.error, true);
        return;
      }
      setView((previous) => ({
        ...previous,
        receipt: result.value,
        claimState: "recorded",
        error: null,
      }));
    });
  }
  function claim(row: ReviewerIntakeRow) {
    if (view.intent !== null || running.current || blocked !== null || changed || unavailable)
      return;
    const intent = Object.freeze({
      caseId: row.id,
      expectedVersion: row.version,
      commandId: crypto.randomUUID(),
    });
    setView((previous) => ({ ...previous, intent, claimState: "prepared", receipt: null }));
    submit(intent);
  }
  return {
    ...view,
    blocked: changed ? ("account_changed" as const) : blocked,
    hideRows: unavailable || !fresh || blocked !== null || changed,
    unavailable,
    needsFresh: !fresh || view.error === "fresh_auth_required",
    refresh: () => read(false),
    more: () => read(true),
    claim,
    retry: () => {
      if (view.intent !== null) submit(view.intent);
    },
    canRetry: view.intent !== null && ["prepared", "uncertain"].includes(view.claimState),
  };
}
