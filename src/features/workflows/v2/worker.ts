import type { PgBoss } from "pg-boss";
import type { Db } from "@/db/client";
import { checkNewsletterDelivery } from "@/features/newsletter/delivery/monitor";
import {
  drainNewsletterIdentityEvents,
  synchronizeNewsletterIdentity,
} from "@/features/newsletter/identity/events";
import { createWorkflowV2Adapters } from "./adapters";
import { admitNewsletterWorkflowEvent } from "./newsletterEvents";
import { enqueueWorkflowV2Run, WORKFLOW_V2_RUN_QUEUE as RUN } from "./queue";
import { drainWorkflowV2RecordOutbox } from "./recordOutbox";
import { advanceWorkflowV2Run } from "./runner";
import { reconcileWorkflowV2 } from "./scheduling";

const RECONCILE = "workflow-v2-reconcile",
  NEWSLETTER_OPERATIONS = "newsletter-operations-monitor";
export async function registerWorkflowV2Jobs(boss: PgBoss, db: Db): Promise<void> {
  await boss.createQueue(RUN);
  await boss.createQueue(RECONCILE);
  await boss.createQueue(NEWSLETTER_OPERATIONS);
  await boss.work(NEWSLETTER_OPERATIONS, async () => {
    await checkNewsletterDelivery(db, AbortSignal.timeout(45_000));
  });
  await boss.schedule(NEWSLETTER_OPERATIONS, "* * * * *", {}, { tz: "UTC" });
  await boss.send(
    NEWSLETTER_OPERATIONS,
    {},
    { retryLimit: 2, expireInSeconds: 60, singletonSeconds: 60 },
  );
  await boss.work<{ runId: string }>(RUN, async ([job]) => {
    if (job === undefined) return;
    const signal = AbortSignal.timeout(45_000);
    const adapters = createWorkflowV2Adapters();
    let more = false;
    for (let step = 0; step < 20; step++) {
      const result = await advanceWorkflowV2Run(db, job.data.runId, adapters, signal);
      more = result.status === "running" || result.status === "queued";
      if (!more) break;
    }
    if (more) await enqueueWorkflowV2Run(boss, job.data.runId);
  });
  await boss.work(RECONCILE, async () => {
    const signal = AbortSignal.timeout(45_000);
    const adapters = createWorkflowV2Adapters();
    const outbox = await drainWorkflowV2RecordOutbox(db, adapters, signal);
    const ready = await reconcileWorkflowV2(db, adapters, signal);
    for (const id of new Set([...outbox, ...ready])) await enqueueWorkflowV2Run(boss, id);
    const syncSignal = AbortSignal.any([signal, AbortSignal.timeout(15_000)]);
    try {
      await synchronizeNewsletterIdentity(db, syncSignal);
    } catch {
      signal.throwIfAborted();
      console.warn("Newsletter identity sync did not complete");
    }
    await drainNewsletterIdentityEvents(
      db,
      async (event) => {
        const runs = await admitNewsletterWorkflowEvent(db, adapters, event, signal);
        for (const id of new Set(runs)) await enqueueWorkflowV2Run(boss, id);
      },
      signal,
    );
  });
  await boss.schedule(RECONCILE, "* * * * *", {}, { tz: "UTC" });
  await boss.send(RECONCILE, {});
}
