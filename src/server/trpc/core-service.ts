import { PgBoss } from "pg-boss";
import { requireCoreProfile } from "@/config/coreEnv";
import { env } from "@/config/env";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { db, pool } from "@/db/client";
import { coreDatabaseRole } from "@/db/corePoolProfile";
import { admitCoreRuntimeRole } from "@/db/coreRoleAdmission";
import { createWebIdentityReader } from "@/features/release/webIdentity";
import { startAppBoss } from "@/jobs/appInstrumentation";
import { setBoss } from "@/jobs/boss";
import { coreProducerOptions } from "@/jobs/coreProducer";
import { assertRuntimeQueueSchema } from "@/jobs/schemaContract";
import { createQueueOperationTracker } from "@/server/runtime/queueOwnership";
import { installSignalShutdown } from "@/server/runtime/shutdown";
import { createContextFromRequest } from "./context-core";
import {
  CORE_API_EDGE_BODY_BYTES,
  type CoreRuntimeDependencies,
  createCoreHttpRuntime,
} from "./core-runtime";
import { createTrpcHttpHandler } from "./http";
import { appRouter } from "./root";

/** Full existing router; only the process owns producer, pool, listener and Web resolver. */
export function startCoreService(serve: CoreRuntimeDependencies["serve"]) {
  requireCoreProfile(env);
  const startupDeadlineAt = performance.now() + 45_000;
  function assertStartupBudget(): void {
    if (performance.now() < startupDeadlineAt) return;
    runtime.markUnavailable("startup");
    throw new AppError(ERROR_IDS.RUNTIME_CORE_API_STARTUP_FAILED, "Core startup deadline elapsed");
  }
  function startupStillAdmitted(): boolean {
    const state = runtime.snapshot();
    return state.state === "starting" && state.failure === null;
  }
  const expectedRole = coreDatabaseRole(env.DATABASE_URL);
  const identity = createWebIdentityReader({
    origin: env.CORE_WEB_ORIGIN,
    timeoutMs: 1_500,
    cacheMs: 1_000,
  });
  let producer: PgBoss | undefined;
  let closingDatabase = false;
  const ownership = createQueueOperationTracker(() => runtime.markUnavailable("producer"));
  const handler = createTrpcHttpHandler({
    router: appRouter,
    createContext: ({ req }) => createContextFromRequest(req, db, identity.read),
  });
  const runtime = createCoreHttpRuntime(
    {
      hostname: env.CORE_HOST,
      port: env.CORE_PORT,
      idleTimeoutSeconds: 120,
      maxRequestBodyBytes: CORE_API_EDGE_BODY_BYTES,
      maxAdmittedBodyBytes: CORE_API_EDGE_BODY_BYTES,
      maxConcurrentRequests: 4,
      bodyTimeoutMs: 30_000,
      probeTimeoutMs: 1_500,
      probeTtlMs: 1_000,
    },
    {
      serve(options) {
        assertStartupBudget();
        const server = serve(options);
        // Register the actual server even if synchronous bind work exceeded the budget.
        if (performance.now() >= startupDeadlineAt) runtime.markUnavailable("startup");
        return server;
      },
      handler,
      async startProducer() {
        assertStartupBudget();
        const role = await admitCoreRuntimeRole((configuration) => pool.query(configuration), {
          expectedRole,
          appSchema: "public",
          queueSchema: "pgboss",
          queryTimeoutMs: 5_000,
        });
        if (!role.ok)
          throw new AppError(
            ERROR_IDS.RUNTIME_CORE_API_STARTUP_FAILED,
            "Core runtime role admission failed",
          );
        if (!startupStillAdmitted()) return;
        assertStartupBudget();
        const web = await identity.read();
        assertStartupBudget();
        if (!web.ok)
          throw new AppError(
            ERROR_IDS.RUNTIME_CORE_API_STARTUP_FAILED,
            "Web identity admission failed",
          );
        if (!startupStillAdmitted()) return;
        await startAppBoss({
          createBoss: () => {
            producer = new PgBoss(coreProducerOptions(env.DATABASE_URL, env));
            return producer;
          },
          admit: () => assertRuntimeQueueSchema(env.DATABASE_URL, undefined, ownership.observe),
          setBoss(boss) {
            assertStartupBudget();
            const state = runtime.snapshot();
            if (state.state === "starting" && state.failure === null) setBoss(boss);
          },
          source: "core-api",
          onFailure: () => runtime.markUnavailable("producer"),
          observeStartup: ownership.observe,
        });
        assertStartupBudget();
      },
      detachProducer: () => setBoss(null),
      async stopProducer() {
        // Startup may visibly time out while its underlying operations are still pending.
        await ownership.waitForSettled();
        await producer?.stop({ graceful: true, timeout: 30_000 });
      },
      async closeDatabase() {
        // Pending/unknown metadata I/O is also part of the owned shutdown, before pool close.
        await identity.close();
        closingDatabase = true;
        await pool.end();
      },
      async probeReadiness(signal) {
        if (runtime.snapshot().state === "starting") assertStartupBudget();
        signal.throwIfAborted();
        const configuration = {
          text: "SELECT 1 AS ok",
          query_timeout: 1_000,
        };
        const alive = await pool.query<{ ok: number }>(configuration);
        signal.throwIfAborted();
        if (alive.rows.length !== 1 || alive.rows[0]?.ok !== 1 || producer === undefined)
          return false;
        const queue = await producer.getQueue("email.sync");
        signal.throwIfAborted();
        if (runtime.snapshot().state === "starting") assertStartupBudget();
        return queue?.name === "email.sync";
      },
      onUnavailable() {
        void shutdown.request();
      },
    },
  );
  const shutdown = installSignalShutdown({
    source: "core-api",
    timeoutMs: 60_000,
    steps: runtime.shutdownSteps(),
  });
  pool.on("error", () => {
    if (!closingDatabase) runtime.markUnavailable("database");
  });
  // One controller owns cleanup; startup expiry never races a separate close-pool chain.
  const startupDeadline = setTimeout(() => runtime.markUnavailable("startup"), 45_000);
  const starting = runtime.start().finally(() => clearTimeout(startupDeadline));
  void starting.catch(() => {
    void shutdown.request();
  });
  return { runtime, shutdown, starting };
}
