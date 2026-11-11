import { useState } from "react";
import type { ObservationRow } from "./types";

export const OPERATIONS_CURSOR_HISTORY_LIMIT = 10;
export function useOperationsCursor<Cursor>() {
  const [history, setHistory] = useState<(Cursor | undefined)[]>([undefined]);
  const cursor = history.at(-1);
  return {
    cursor,
    page: history.length,
    first: () => setHistory([undefined]),
    previous: () =>
      setHistory((previous) => (previous.length > 1 ? previous.slice(0, -1) : previous)),
    canNext: (next: Cursor | null | undefined) =>
      next !== null &&
      next !== undefined &&
      history.length < OPERATIONS_CURSOR_HISTORY_LIMIT &&
      !history.some((item) => JSON.stringify(item) === JSON.stringify(next)),
    next: (next: Cursor | null | undefined) => {
      if (next === null || next === undefined) return;
      setHistory((previous) =>
        previous.length < OPERATIONS_CURSOR_HISTORY_LIMIT &&
        !previous.some((item) => JSON.stringify(item) === JSON.stringify(next))
          ? [...previous, next]
          : previous,
      );
    },
  };
}

export function operationsVisibleState(
  row: ObservationRow,
  checkedAt: string,
  requestedAt: number,
  now: number,
  unavailable: boolean,
): ObservationRow["state"] {
  if (unavailable || row.sourceState !== "active") return "unknown";
  if (row.freshness.status === "unchecked") return "unchecked";
  if (row.freshness.status === "unknown") return "unknown";
  if (row.freshness.status === "stale") return "stale";
  const checked = Date.parse(checkedAt);
  const staleAt = row.freshness.staleAtMs;
  if (!Number.isFinite(checked) || !Number.isFinite(now) || now < requestedAt || staleAt === null)
    return "unknown";
  // Mapping the server check to request START conservatively includes transport/query time.
  return checked + (now - requestedAt) >= staleAt ? "stale" : row.state;
}
