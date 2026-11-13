import type { PgBoss } from "pg-boss";
import { type BossProcess, observeBossErrors } from "./bossObserver";
import { type QueueOperationObserver, startAdmittedRuntimeBoss } from "./schemaContract";

// Injectable deps so the wiring is unit-testable without a live queue. The Next app process boots
// pg-boss here purely as a PRODUCER: it must publish a live boss so `getBoss()` stops returning
// null (otherwise email send, activity reminders, and import enqueues silently no-op in the web
// process). Job handlers are intentionally NOT registered here; they belong to the dedicated
// `worker` service, so registering them in the app too would double-process every job.
// The nodejs-runtime guard lives in the caller (instrumentation.register), which must decide
// whether to boot BEFORE importing the node-only env module; this stays runtime-agnostic.
export type StartAppBossDeps = {
  createBoss: () => PgBoss;
  admit: () => Promise<void>;
  setBoss: (boss: PgBoss) => void;
  source?: BossProcess;
  onFailure?: () => void;
  observeStartup?: QueueOperationObserver;
};

export async function startAppBoss(deps: StartAppBossDeps): Promise<PgBoss> {
  const boss = deps.createBoss();
  observeBossErrors(boss, deps.source ?? "app", deps.onFailure);
  await startAdmittedRuntimeBoss(boss, deps.admit, deps.observeStartup);
  // Publish only after start resolves so producers never see an unstarted boss.
  deps.setBoss(boss);
  return boss;
}
