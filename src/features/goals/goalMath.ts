// Attainment and pace. Both take decimal strings so money survives from numeric(14,2)
// without a float in the middle of the round trip.

// Booked over target, uncapped: 120% of quota must read as 120%, not as a full bar.
// Minimum quotas need a positive target. Upper limits also support zero, and exceeding
// a limit must reduce attainment rather than reward extra losses.
export function attainment(
  actual: string,
  target: string,
  direction: "at_least" | "at_most" = "at_least",
): number | null {
  const t = Number(target);
  const a = Number(actual);
  if (!Number.isFinite(t) || !Number.isFinite(a) || t < 0 || a < 0) return null;
  if (direction === "at_most") return a <= t ? 1 : t / a;
  if (t === 0) return null;
  return a / t;
}

// Attainment relative to how much of the period is gone: 1 means exactly on track, above
// means ahead. Null before any time has elapsed, since nothing can be on or off track yet.
export function pace(attained: number | null, elapsed: number): number | null {
  if (attained === null || elapsed <= 0) return null;
  return attained / elapsed;
}
