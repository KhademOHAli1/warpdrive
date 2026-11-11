import { env } from "@/config/env";
import type { Db } from "@/db/client";
import { createListmonkClient, newsletterConfigured } from "../listmonkClient";
import type { ReadinessReason } from "./operationalContracts";
import {
  persistOperationalEvents,
  recordOperationalHealth,
  recordOperationalPoll,
} from "./operationalRepository";
import { drainOperationalEvents } from "./operationalSync";
import { type EngineReadiness, readEngineReadiness } from "./readiness";

type Read = (signal: AbortSignal) => Promise<EngineReadiness>;
type Report = (state: string, level: "warn" | "info", signal: AbortSignal) => Promise<void> | void;
class OperationalSyncUnavailable extends Error {}

export function readinessFingerprint(state: EngineReadiness): string {
  if (state.scheduler.status === "passive") return "paused";
  if (state.ready) return "ready";
  return [
    state.database.status,
    state.scheduler.status,
    state.relay.status,
    state.media.status,
    state.feedback.status,
  ].join("/");
}

export function readinessReason(state: string): ReadinessReason | null {
  if (state === "ready" || state === "paused") return null;
  if (state === "events_unavailable") return "events_unavailable";
  if (state === "unreachable") return "service_unreachable";
  const [database, scheduler, relay, media] = state.split("/");
  if (database === "migration_required") return "database_migration";
  if (database !== "ready") return "database_unavailable";
  if (scheduler === "stale") return "scheduler_stale";
  if (scheduler === "starting") return "scheduler_starting";
  if (relay === "unconfigured") return "relay_unconfigured";
  if (relay !== "ready") return "relay_unavailable";
  if (media === "unchecked") return "media_unchecked";
  if (media !== "ready") return "media_unavailable";
  return "feedback_unconfirmed";
}

/** A rejected asynchronous sink remains pending and is retried before observing a later recovery. */
export function createNewsletterReadinessMonitor(
  read: Read,
  report: Report,
  options: { reportInitial?: boolean; reportUnchanged?: boolean } = {},
) {
  let previous: string | undefined = options.reportInitial === true ? undefined : "ready";
  let pending: { state: string; level: "warn" | "info" } | undefined;
  async function flush(signal: AbortSignal): Promise<void> {
    if (!pending) return;
    signal.throwIfAborted();
    await report(pending.state, pending.level, signal);
    previous = pending.state;
    pending = undefined;
  }
  async function tick(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    await flush(signal);
    const state = await read(signal).then(readinessFingerprint, (error: unknown) =>
      error instanceof OperationalSyncUnavailable ? "events_unavailable" : "unreachable",
    );
    signal.throwIfAborted();
    if (options.reportUnchanged !== true && state === previous) return;
    pending = { state, level: state === "ready" || state === "paused" ? "info" : "warn" };
    await flush(signal);
  }
  let tail: Promise<void> = Promise.resolve();
  return (signal: AbortSignal): Promise<void> => {
    const current = tail.then(() => tick(signal));
    tail = current.catch(() => undefined);
    return current;
  };
}

const monitors = new WeakMap<Db, ReturnType<typeof createNewsletterReadinessMonitor>>();
const passive: EngineReadiness = {
  ready: false,
  database: { status: "ready" },
  scheduler: { status: "passive", lastScanAt: null },
  relay: { status: "unconfigured", checkedAt: null },
  media: { status: "unchecked", checkedAt: null },
  limits: {
    workers: 0,
    perWorkerMessagesPerSecond: 0,
    messagesPerSecond: 0,
    batchSize: 0,
    queueCapacity: 0,
    clamped: false,
  },
  feedback: { status: "disabled", lastEventAt: null },
};

export async function checkNewsletterDelivery(db: Db, signal: AbortSignal): Promise<void> {
  if (!newsletterConfigured()) return;
  let monitor = monitors.get(db);
  if (!monitor) {
    monitor = createNewsletterReadinessMonitor(
      async (currentSignal) => {
        const client = createListmonkClient(
          AbortSignal.any([currentSignal, AbortSignal.timeout(15_000)]),
        );
        try {
          // Feedback can arrive after the sender was deliberately paused.
          await drainOperationalEvents(
            client,
            (events) => persistOperationalEvents(db, events, currentSignal),
            currentSignal,
          );
          await recordOperationalPoll(db, currentSignal);
        } catch {
          currentSignal.throwIfAborted();
          throw new OperationalSyncUnavailable();
        }
        return env.NEWSLETTER_DELIVERY_ENABLED ? readEngineReadiness(client) : passive;
      },
      async (state, level, currentSignal) => {
        const result = await recordOperationalHealth(
          db,
          { fingerprint: state, reason: readinessReason(state) },
          currentSignal,
        );
        if (!result.changed) return;
        const event = { event: "newsletter.delivery.readiness", level, readiness: state };
        if (level === "warn") process.stderr.write(`${JSON.stringify(event)}\n`);
        else process.stdout.write(`${JSON.stringify(event)}\n`);
      },
      { reportInitial: true, reportUnchanged: true },
    );
    monitors.set(db, monitor);
  }
  await monitor(signal);
}
