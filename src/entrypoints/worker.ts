import type { PgBoss } from "pg-boss";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { pool } from "@/db/client";
import { setBoss } from "@/jobs/boss";
import {
  createWorkerCallbackTracker,
  installSignalShutdown,
  workerShutdownSteps,
} from "@/server/runtime/shutdown";
import { startWorker } from "@/server/worker";

// Bundled entrypoint for the compose `worker` service (esbuild -> dist/worker.js, run
// with plain node). Boots pg-boss, publishes the singleton, registers all job handlers.
const callbacks = createWorkerCallbackTracker();
let created: PgBoss | undefined;
let startupFailed = false;
const starting = startWorker((boss) => {
  created = boss;
  callbacks.install(boss);
});
const owned = starting.catch(() => {
  startupFailed = true;
  if (created !== undefined) return created;
  throw new AppError(ERROR_IDS.RUNTIME_WORKER_MISSING, "Worker startup did not create a runtime");
});
const shutdown = installSignalShutdown({
  source: "worker",
  timeoutMs: 60_000,
  steps: [
    ...workerShutdownSteps(
      owned,
      () => pool.end(),
      () => setBoss(null),
      callbacks,
    ),
    {
      name: "startup",
      run() {
        if (startupFailed)
          throw new AppError(ERROR_IDS.RUNTIME_WORKER_STARTUP_FAILED, "Worker startup failed");
      },
    },
  ],
});
// Startup failure is distinct from a clean drain; the controller emits a fixed safe outcome.
void starting.catch(() => shutdown.request());
