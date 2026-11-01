"use client";

import { useLayoutEffect, useRef } from "react";
import { trpc } from "@/lib/trpc-client";
import { err } from "@/types/result";
import { invalidateDeliveryObservationReaders } from "./invalidateDeliveryObservationReaders";
import { PrivateIntakePanel } from "./PrivateIntakePanel";
import {
  readPrivateIntakeSummary,
  reviewPrivateIntakeSummary,
} from "./privateIntakeTransport.client";
import type { PrivateIntakeReviewResult, PrivateIntakeSummary } from "./privateIntakeTypes";
import { useDeliveryObservationVisibility } from "./useDeliveryObservationVisibility";

export interface ReaderPrivateIntakeProps {
  accountId: string;
  messageId?: string;
  threadId?: string;
  summary: PrivateIntakeSummary | null;
}

interface ReaderLease {
  controller: AbortController;
  timer?: ReturnType<typeof setTimeout>;
}

function PrivateReaderSession({
  accountId,
  summary,
}: ReaderPrivateIntakeProps & { summary: PrivateIntakeSummary }) {
  const ref = useRef<HTMLDivElement>(null);
  const visible = useDeliveryObservationVisibility(ref);
  const active = useRef<ReaderLease | null>(null);
  const newest = useRef(summary);
  const utils = trpc.useUtils();
  useLayoutEffect(() => {
    if (summary.revision > newest.current.revision) newest.current = summary;
  }, [summary]);
  useLayoutEffect(() => {
    if (!visible) return;
    const lease: ReaderLease = { controller: new AbortController() };
    active.current = lease;
    return () => {
      lease.controller.abort();
      if (lease.timer !== undefined) clearTimeout(lease.timer);
      if (active.current === lease) active.current = null;
    };
  }, [visible]);

  async function inScope(
    operation: (signal: AbortSignal) => Promise<PrivateIntakeReviewResult>,
    caller: AbortSignal,
  ): Promise<PrivateIntakeReviewResult> {
    caller.throwIfAborted();
    const lease = active.current;
    if (lease === null) throw new DOMException("Reader scope changed", "AbortError");
    const signal = AbortSignal.any([caller, lease.controller.signal]);
    signal.throwIfAborted();
    const result = await operation(signal);
    signal.throwIfAborted();
    if (active.current !== lease) throw new DOMException("Reader scope changed", "AbortError");
    return result;
  }

  function acknowledged(saved: PrivateIntakeSummary): void {
    const lease = active.current;
    if (lease === null || saved.id !== summary.id || saved.revision < newest.current.revision)
      return;
    newest.current = saved;
    if (lease.timer !== undefined) clearTimeout(lease.timer);
    // The panel calls this only after consuming the native callback and saving its local state.
    // Keep cache/DTO refresh after that acknowledgement, including for a same-revision fresh read.
    lease.timer = setTimeout(() => {
      if (!lease.controller.signal.aborted && active.current === lease)
        invalidateDeliveryObservationReaders(utils);
    }, 0);
  }

  return (
    <div ref={ref}>
      <PrivateIntakePanel
        isOwner
        active={visible}
        summary={summary}
        onReview={(input, signal) =>
          inScope((current) => reviewPrivateIntakeSummary({ accountId, ...input }, current), signal)
        }
        onRefresh={async (signal) => {
          const result = await inScope(
            (current) => readPrivateIntakeSummary({ accountId, intakeId: summary.id }, current),
            signal,
          );
          return result.ok && result.value.revision < newest.current.revision
            ? err("conflict")
            : result;
        }}
        onReviewed={acknowledged}
      />
    </div>
  );
}

/** Owner DTO hints select the surface; the native full-session API owns every action. */
export function ReaderPrivateIntake(props: ReaderPrivateIntakeProps): React.ReactNode {
  if (props.summary === null || (props.messageId === undefined && props.threadId === undefined))
    return null;
  const key = JSON.stringify([
    props.accountId,
    props.messageId ?? null,
    props.threadId ?? null,
    props.summary.id,
  ]);
  return <PrivateReaderSession key={key} {...props} summary={props.summary} />;
}
