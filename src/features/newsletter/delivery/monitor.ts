import { env } from "@/config/env";
import { createListmonkClient, newsletterConfigured } from "../listmonkClient";
import { type EngineReadiness, readEngineReadiness } from "./readiness";

type Read = (signal: AbortSignal) => Promise<EngineReadiness>;
type Report = (state: string, level: "warn" | "info") => void;

function readinessFingerprint(state: EngineReadiness): string {
  if (state.ready) return "ready";
  return [
    state.database.status,
    state.scheduler.status,
    state.relay.status,
    state.media.status,
    state.feedback.status,
  ].join("/");
}

export function createNewsletterReadinessMonitor(read: Read, report: Report) {
  let previous = "ready";
  return async (signal: AbortSignal): Promise<void> => {
    const state = await read(signal).then(readinessFingerprint, () => "unreachable");
    if (signal.aborted || state === previous) return;
    previous = state;
    report(state, state === "ready" ? "info" : "warn");
  };
}

const monitor = createNewsletterReadinessMonitor(
  (signal) =>
    readEngineReadiness(
      createListmonkClient(AbortSignal.any([signal, AbortSignal.timeout(8_000)])),
    ),
  (state, level) => {
    if (level === "warn") console.warn("Newsletter delivery unavailable", { readiness: state });
    else console.info("Newsletter delivery recovered", { readiness: state });
  },
);

export async function checkNewsletterDelivery(signal: AbortSignal): Promise<void> {
  if (!env.NEWSLETTER_DELIVERY_ENABLED || !newsletterConfigured()) return;
  await monitor(signal);
}
