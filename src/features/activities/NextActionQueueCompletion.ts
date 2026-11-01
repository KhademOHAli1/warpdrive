"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { ERROR_IDS } from "@/constants/errorIds";
import type {
  NextActionQueueProps,
  QueueCompletionKind,
  QueueCompletionState,
} from "./NextActionQueue.types";
import type { NextActionActivityRow } from "./next-action-queue/queueTypes";

const DENIED = new Set<string>([
  ERROR_IDS.PERM_DENIED,
  ERROR_IDS.AUTH_SESSION_DEAD,
  ERROR_IDS.ACTIVITY_NOT_FOUND,
  ERROR_IDS.ACTIVITY_FORBIDDEN,
]);

function failureKind(id: string): QueueCompletionKind {
  if (DENIED.has(id)) return "denied";
  return id === ERROR_IDS.DB_WRITE_FAILED ? "unconfirmed" : "failed";
}

export function useNextActionQueueCompletion({
  readId,
  complete,
  refresh,
}: {
  readId: string | null;
  complete: NextActionQueueProps["onCompleteActivity"];
  refresh: () => void;
}) {
  const [states, setStates] = useState<Record<string, QueueCompletionState>>({});
  const [pendingId, setPendingId] = useState<string | null>(null);
  const inFlight = useRef(false);
  const latestReadId = useRef(readId);
  useLayoutEffect(() => {
    if (readId !== null) latestReadId.current = readId;
  }, [readId]);

  function stateFor(id: string): QueueCompletionState | undefined {
    const state = states[id];
    return state?.kind === "saved" && state.readId !== readId ? undefined : state;
  }

  async function submit(row: NextActionActivityRow, reviewed = false): Promise<void> {
    if (complete === undefined || readId === null || !row.canComplete || inFlight.current) return;
    const previous = stateFor(row.id);
    if (
      previous !== undefined &&
      (!reviewed || previous.readId === readId || previous.kind === "pending")
    )
      return;
    const sourceReadId = readId;
    inFlight.current = true;
    setPendingId(row.id);
    setStates((before) => ({ ...before, [row.id]: { kind: "pending", readId: sourceReadId } }));
    try {
      const result = await complete({ id: row.id, done: true });
      const kind = !result.ok
        ? failureKind(result.error.id)
        : result.value.id === row.id
          ? "saved"
          : "unconfirmed";
      // A read delivered while the request was pending cannot confirm its later outcome.
      const barrier = latestReadId.current ?? sourceReadId;
      setStates((before) => ({ ...before, [row.id]: { kind, readId: barrier } }));
      if (kind === "saved" || kind === "denied") refresh();
    } catch {
      const barrier = latestReadId.current ?? sourceReadId;
      setStates((before) => ({ ...before, [row.id]: { kind: "unconfirmed", readId: barrier } }));
    } finally {
      inFlight.current = false;
      setPendingId(null);
    }
  }

  // A known write or access change makes the old page's rows and totals stale together.
  const held =
    readId === null
      ? undefined
      : Object.values(states).find(
          (state) => state.readId === readId && (state.kind === "saved" || state.kind === "denied"),
        )?.kind;
  return { pendingId, stateFor, submit, held };
}
