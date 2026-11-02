"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { err } from "@/types/result";
import type { PrivateIntakePanelProps } from "./PrivateIntakePanel";
import type {
  PrivateIntakeReviewDecision,
  PrivateIntakeReviewError,
  PrivateIntakeReviewResult,
  PrivateIntakeSummary,
} from "./privateIntakeTypes";

interface PanelState {
  summary: PrivateIntakeSummary;
  open: boolean;
  busy: "review" | "refresh" | null;
  error: PrivateIntakeReviewError | null;
  saved: boolean;
}

function initialState(summary: PrivateIntakeSummary): PanelState {
  return { summary, open: false, busy: null, error: null, saved: false };
}

/** Typed native callbacks own validation and authorization; this hook owns only UI lifetime. */
export function usePrivateIntakePanel({
  summary,
  onReview,
  onReviewed,
  onRefresh,
  active: enabled = true,
}: Omit<PrivateIntakePanelProps, "isOwner" | "summary"> & {
  summary: PrivateIntakeSummary;
}) {
  const [state, setState] = useState(() => initialState(summary));
  const latest = useRef(summary);
  const active = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const enabledRef = useRef(enabled);

  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      active.current?.abort();
      active.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    enabledRef.current = enabled;
    if (enabled) return;
    const pending = active.current;
    pending?.abort();
    active.current = null;
    setState((previous) =>
      previous.open || previous.busy !== null
        ? {
            ...previous,
            open: false,
            busy: null,
            error: pending === null ? previous.error : "unavailable",
          }
        : previous,
    );
  }, [enabled]);

  useLayoutEffect(() => {
    if (summary.revision <= latest.current.revision) return;
    active.current?.abort();
    active.current = null;
    latest.current = summary;
    setState(initialState(summary));
  }, [summary]);

  const isCurrent = (request: AbortController): boolean =>
    mounted.current && enabledRef.current && active.current === request && !request.signal.aborted;

  const run = async (
    kind: "review" | "refresh",
    operation: (signal: AbortSignal) => Promise<PrivateIntakeReviewResult>,
  ): Promise<void> => {
    if (!enabledRef.current || active.current !== null) return;
    const request = new AbortController();
    active.current = request;
    setState((previous) => ({ ...previous, busy: kind, saved: false }));
    let result: PrivateIntakeReviewResult;
    try {
      result = await operation(request.signal);
    } catch {
      // Abort/obsolete callbacks never publish an error or overwrite a newer record.
      if (!isCurrent(request)) return;
      result = err("unavailable");
    }
    if (!isCurrent(request)) return;
    active.current = null;
    if (!result.ok) {
      setState((previous) => ({ ...previous, busy: null, error: result.error }));
      return;
    }
    latest.current = result.value;
    setState({ ...initialState(result.value), saved: kind === "review" });
    onReviewed?.(result.value);
  };

  const review = (decision: PrivateIntakeReviewDecision): Promise<void> => {
    if (!enabledRef.current || state.error !== null) return Promise.resolve();
    const current = latest.current;
    return run("review", (signal) =>
      onReview({ intakeId: current.id, expectedRevision: current.revision, decision }, signal),
    );
  };

  const refresh = (): Promise<void> => {
    if (!enabledRef.current || onRefresh === undefined) return Promise.resolve();
    return run("refresh", onRefresh);
  };

  const setOpen = (open: boolean): void => {
    if (!enabledRef.current) return;
    const pending = active.current;
    if (!open && pending !== null) {
      pending.abort();
      active.current = null;
      // Cancellation cannot establish whether the server committed. Require a fresh read.
      setState((previous) => ({ ...previous, open, busy: null, error: "unavailable" }));
      return;
    }
    setState((previous) => ({ ...previous, open }));
  };

  return { ...state, enabled, review, refresh, setOpen };
}
