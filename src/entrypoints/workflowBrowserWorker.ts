import { sql } from "drizzle-orm";
import { PgBoss } from "pg-boss";
import { env } from "@/config/env";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { db, pool } from "@/db/client";
import { registerWorkflowJobs } from "@/features/workflows/worker";
import { setBoss } from "@/jobs/boss";
import { observeBossErrors } from "@/jobs/bossObserver";

async function runWorkflowBrowserWorker(): Promise<void> {
  const stop = new AbortController();
  const requestStop = () => stop.abort();
  process.once("SIGINT", requestStop);
  process.once("SIGTERM", requestStop);
  let boss: PgBoss | null = null;
  try {
    const target = new URL(env.DATABASE_URL);
    const name = target.pathname.slice(1);
    if (
      env.NODE_ENV !== "test" ||
      !["postgres:", "postgresql:"].includes(target.protocol) ||
      !/^t_[a-f0-9]{32}$/.test(name) ||
      target.hostname === "" ||
      target.port === "" ||
      target.search !== "" ||
      target.hash !== ""
    )
      throw new AppError(ERROR_IDS.DB_INVARIANT, "Disposable test worker database required");
    const current = await db.execute<{ name: string }>(
      sql.raw("SELECT current_database() AS name"),
    );
    if (current.rows[0]?.name !== name)
      throw new AppError(ERROR_IDS.DB_INVARIANT, "Test worker database handle mismatch");

    boss = new PgBoss(env.DATABASE_URL);
    observeBossErrors(boss, "worker");
    await boss.start();
    if (stop.signal.aborted) return;
    setBoss(boss);
    // Only the current workflow queues/handlers, minutely schedule and boot reconciliation.
    await registerWorkflowJobs(boss, db);
    console.warn("Synthetic workflow-only worker ready");
    await new Promise<void>((resolve) => {
      if (stop.signal.aborted) {
        resolve();
        return;
      }
      stop.signal.addEventListener("abort", () => resolve(), { once: true });
    });
  } finally {
    process.removeListener("SIGINT", requestStop);
    process.removeListener("SIGTERM", requestStop);
    try {
      if (boss !== null) await boss.stop({ graceful: true, timeout: 10_000 });
    } finally {
      await pool.end();
    }
  }
}

void runWorkflowBrowserWorker().catch(() => {
  // Do not serialize a DSN, provider payload or original error/stack.
  console.error("Synthetic workflow-only worker failed");
  process.exitCode = 1;
});
