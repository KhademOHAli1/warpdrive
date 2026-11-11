// The worker normally polls every few seconds. Five minutes leaves ample room for a bounded drain.
export const OPERATIONAL_STALE_AFTER_MS = 5 * 60 * 1000;
export interface OperationalSyncSnapshot {
  status: "current" | "stale" | "unchecked";
  checkedAt: string | null;
  lastPolledAt: string | null;
}
export function operationalSyncSnapshot(
  row: { checkedAt: Date; lastPolledAt: Date | null } | undefined,
  now = new Date(),
): OperationalSyncSnapshot {
  const fresh = (date: Date | null) =>
    date !== null && now.getTime() - date.getTime() <= OPERATIONAL_STALE_AFTER_MS;
  return {
    status: !row
      ? "unchecked"
      : fresh(row.checkedAt) && fresh(row.lastPolledAt)
        ? "current"
        : "stale",
    checkedAt: row?.checkedAt.toISOString() ?? null,
    lastPolledAt: row?.lastPolledAt?.toISOString() ?? null,
  };
}
