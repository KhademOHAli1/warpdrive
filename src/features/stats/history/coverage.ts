import { Temporal } from "@js-temporal/polyfill";
import type { HistoryActivation } from "./contracts";

export interface HistoryCoverage {
  state: "missing" | "partial" | "observed" | "invalid";
  reason:
    | "capture-not-installed"
    | "before-activation"
    | "within-observed-interval"
    | "invalid-window";
  reliableFrom: string | null;
  observationCutoff: string;
  pastTransitionsInferred: false;
}

// Coverage of capture is not coverage of permissions, source business evidence or a model.
export function assessHistoryCoverage(
  activation: HistoryActivation | null,
  from: string,
  observationCutoff: string,
): HistoryCoverage {
  const base = {
    reliableFrom: activation?.activatedAt ?? null,
    observationCutoff,
    pastTransitionsInferred: false as const,
  };
  try {
    if (Temporal.Instant.compare(from, observationCutoff) > 0)
      return { ...base, state: "invalid", reason: "invalid-window" };
    if (activation === null) return { ...base, state: "missing", reason: "capture-not-installed" };
    if (Temporal.Instant.compare(activation.activatedAt, observationCutoff) > 0)
      return { ...base, state: "missing", reason: "capture-not-installed" };
    if (Temporal.Instant.compare(from, activation.activatedAt) < 0)
      return { ...base, state: "partial", reason: "before-activation" };
    return { ...base, state: "observed", reason: "within-observed-interval" };
  } catch {
    return { ...base, state: "invalid", reason: "invalid-window" };
  }
}
