import type { PgBoss as PgBossType } from "pg-boss";
import { PgBoss } from "pg-boss";
import { env } from "@/config/env";
import { db } from "@/db/client";
import { registerCalendarReminderWorker } from "@/features/activities/calendarReminders";
import { registerReminderWorker } from "@/features/activities/reminders";
import { registerAuthMailWorker } from "@/features/auth/management/workers";
import { registerEmailJobs } from "@/features/email/workerJobs";
import { registerReaperJob } from "@/features/files/reaper";
import { registerImportWorkers } from "@/features/import/registerImportWorkers";
import { registerEmailNotificationWorker } from "@/features/notifications/email/job";
import {
  OPERATIONS_WORKER_HEARTBEAT_SECONDS,
  OPERATIONS_WORKER_INSTANCE_NAME,
} from "@/features/operations/workerHeartbeat";
import { registerReleaseCheckJob } from "@/features/release/job";
import { registerWorkflowV2Jobs } from "@/features/workflows/v2/worker";
import { registerWorkflowJobs } from "@/features/workflows/worker";
import { setBoss } from "@/jobs/boss";
import { observeBossErrors } from "@/jobs/bossObserver";
import {
  assertRuntimeQueueSchema,
  runtimeQueueOptions,
  startAdmittedRuntimeBoss,
} from "@/jobs/schemaContract";

// Register all job handlers and schedules. Called after boss.start() and
// setBoss() so producers see the live boss before handlers are registered.
// Order: email jobs first (sync + send handlers + initial enqueues), then
// the file reaper (hourly cron schedule), then the activity reminder worker.
export async function registerAllJobs(boss: PgBossType): Promise<void> {
  await registerEmailJobs(boss);
  await registerReaperJob(boss);
  await registerImportWorkers(boss);
  await registerEmailNotificationWorker(boss);
  await registerReminderWorker(boss);
  await registerCalendarReminderWorker(boss);
  await registerAuthMailWorker(boss, db);
  // Update-check cron (OSS self-hosters). No-op when DISABLE_UPDATE_CHECK is set.
  await registerReleaseCheckJob(boss);
  await registerWorkflowJobs(boss, db);
  await registerWorkflowV2Jobs(boss, db);
}

// Compose `worker` service. Boots pg-boss, publishes the singleton so producers
// can enqueue, then registers all job handlers and cron schedules.
export async function startWorker(observe?: (boss: PgBoss) => void): Promise<PgBoss> {
  const boss = new PgBoss({
    connectionString: env.DATABASE_URL,
    ...runtimeQueueOptions("worker"),
    instanceName: OPERATIONS_WORKER_INSTANCE_NAME,
    instanceHeartbeatSeconds: OPERATIONS_WORKER_HEARTBEAT_SECONDS,
  });
  observeBossErrors(boss, "worker");
  observe?.(boss);
  await startAdmittedRuntimeBoss(boss, () => assertRuntimeQueueSchema(env.DATABASE_URL));
  // Publish the live boss before registering handlers so producers that run
  // during registration (e.g. initial sync enqueues) already see a live boss.
  setBoss(boss);
  // The entrypoint already tracks every callback and owns drain/cleanup on registration failure.
  await registerAllJobs(boss);
  console.warn("worker (pg-boss) started");
  return boss;
}
