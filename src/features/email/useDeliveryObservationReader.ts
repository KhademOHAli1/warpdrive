"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { err } from "@/types/result";
import type {
  DeliveryObservationReaderScope,
  DeliveryObservationReaderState,
} from "./deliveryObservationReader.types";
import { loadDeliveryObservationReader } from "./deliveryObservationReaderLoad";
import { reviewDeliveryObservation } from "./deliveryObservationTransport.client";
import type { DeliveryReviewInput } from "./deliveryObservationTypes";

type Snapshot = Pick<
  DeliveryObservationReaderState,
  "reports" | "targets" | "loading" | "error" | "generation"
> & { key: string };
interface Lease {
  key: string;
  generation: number;
  controller: AbortController;
  ready: boolean;
  timer?: ReturnType<typeof setTimeout>;
}
const empty = { reports: [], targets: [], error: null };

function assertCurrent(lease: Lease | null, active: Lease | null): asserts lease is Lease {
  lease?.controller.signal.throwIfAborted();
  if (lease === null || lease !== active || !lease.ready)
    throw new DOMException("Reader scope changed", "AbortError");
}

export function useDeliveryObservationReader(
  scope: DeliveryObservationReaderScope,
  enabled: boolean,
  onReviewed?: () => void,
): DeliveryObservationReaderState {
  const [refresh, setRefresh] = useState(0);
  const selector =
    scope.reference.kind === "source" ? scope.reference.sourceMessageId : scope.reference.attemptId;
  const key = JSON.stringify([
    scope.accountId,
    scope.messageId,
    scope.reference.kind,
    selector,
    scope.threadId ?? null,
    refresh,
  ]);
  const [snapshot, setSnapshot] = useState<Snapshot>({
    ...empty,
    key,
    loading: enabled,
    generation: 0,
  });
  const active = useRef<Lease | null>(null);
  const sequence = useRef(0);
  const changed = useRef(onReviewed);
  useLayoutEffect(() => {
    changed.current = onReviewed;
  }, [onReviewed]);

  useLayoutEffect(() => {
    const lease: Lease = {
      key,
      generation: ++sequence.current,
      controller: new AbortController(),
      ready: false,
    };
    active.current = lease;
    setSnapshot({ ...empty, key, generation: lease.generation, loading: enabled });
    if (enabled) {
      // Reconstruct from the stable identity. Equivalent DTO object reprops must not reset review lockouts.
      const [accountId, messageId, kind, id] = JSON.parse(key) as [
        string,
        string,
        "source" | "attempt",
        string,
        string | null,
        number,
      ];
      const requestScope: DeliveryObservationReaderScope = {
        accountId,
        messageId,
        reference: kind === "source" ? { kind, sourceMessageId: id } : { kind, attemptId: id },
      };
      void loadDeliveryObservationReader(requestScope, lease.controller.signal).then(
        (result) => {
          if (lease.controller.signal.aborted || active.current !== lease) return;
          lease.ready = result.ok;
          setSnapshot({
            ...(result.ok ? { ...result.value, error: null } : { ...empty, error: result.error }),
            key,
            generation: lease.generation,
            loading: false,
          });
        },
        () => {
          if (lease.controller.signal.aborted || active.current !== lease) return;
          setSnapshot({
            ...empty,
            key,
            generation: lease.generation,
            loading: false,
            error: "unknown",
          });
        },
      );
    }
    return () => {
      lease.controller.abort();
      lease.ready = false;
      if (lease.timer !== undefined) clearTimeout(lease.timer);
      if (active.current === lease) active.current = null;
    };
  }, [key, enabled]);

  const generation = snapshot.generation;
  const onReview = useCallback(
    async (input: DeliveryReviewInput) => {
      const lease = active.current;
      if (!enabled || lease?.key !== key || lease.generation !== generation)
        throw new DOMException("Reader scope changed", "AbortError");
      assertCurrent(lease, active.current);
      try {
        const result = await reviewDeliveryObservation(
          { accountId: scope.accountId, input },
          lease.controller.signal,
        );
        assertCurrent(lease, active.current);
        if (result.ok) {
          // Let DeliveryReportReview consume this Promise and save its local revision first.
          // Replacing canonical props before its await resumes would falsely flag a stale save.
          if (lease.timer !== undefined) clearTimeout(lease.timer);
          lease.timer = setTimeout(() => {
            if (lease.controller.signal.aborted || active.current !== lease) return;
            changed.current?.();
            if (active.current === lease) setRefresh((value) => value + 1);
          }, 0);
        }
        return result;
      } catch (error) {
        lease.controller.signal.throwIfAborted();
        if (error instanceof Error && error.name === "AbortError") throw error;
        return err("unknown" as const);
      }
    },
    [enabled, key, generation, scope.accountId],
  );
  const refreshRead = useCallback(() => {
    setRefresh((value) => value + 1);
  }, []);
  return {
    ...(snapshot.key === key && enabled ? snapshot : { ...empty, generation, loading: enabled }),
    refresh: refreshRead,
    onReview,
  };
}
