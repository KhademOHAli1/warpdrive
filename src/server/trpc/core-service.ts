import { PgBoss } from "pg-boss";
import { requireCoreProfile } from "@/config/coreEnv";
import { env } from "@/config/env";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { type CoreDiagnosticCode, coreDrainStepSchema } from "@/contracts/coreDiagnostics";
import { db, pool } from "@/db/client";
import { coreDatabaseRole } from "@/db/corePoolProfile";
import { admitCoreRuntimeRole } from "@/db/coreRoleAdmission";
import { createWebIdentityReader, type ReadWebIdentity } from "@/features/release/webIdentity";
import { startAppBoss } from "@/jobs/appInstrumentation";
import { setBoss } from "@/jobs/boss";
import { coreProducerOptions } from "@/jobs/coreProducer";
import { assertRuntimeQueueSchema } from "@/jobs/schemaContract";
import { acceptsBackendPath, handleBackendHttp } from "@/server/http/handler";
import { admitFrontendRequest } from "@/server/http/proxyAuthority";
import { drainRequestTasks, withBackendRequest } from "@/server/request";
import {
  type CoreDiagnosticSink,
  reportCoreDiagnostic,
  writeCoreDiagnostic,
} from "@/server/runtime/coreDiagnostics";
import { createQueueOperationTracker } from "@/server/runtime/queueOwnership";
import { installSignalShutdown } from "@/server/runtime/shutdown";
import { err } from "@/types/result";
import { createContext } from "./context";
import {
  CORE_API_EDGE_BODY_BYTES,
  type CoreRuntimeDependencies,
  createCoreHttpRuntime,
} from "./core-runtime";
import { createTrpcHttpHandler } from "./http";
import { readRequestCsrf } from "./request-csrf";
import { appRouter } from "./root";

/** Full existing router; only the process owns producer, pool, listener and Web resolver. */
export function startCoreService(
  serve: CoreRuntimeDependencies["serve"],
  diagnostics: CoreDiagnosticSink = writeCoreDiagnostic,
) {
  requireCoreProfile(env);
  const startupDeadlineAt = performance.now() + 45_000;
  function assertStartupBudget(): void {
    if (performance.now() < startupDeadlineAt) return;
    runtime.markUnavailable("startup", "CORE_STARTUP_TIMEOUT");
    throw new AppError(ERROR_IDS.RUNTIME_CORE_API_STARTUP_FAILED, "Core startup deadline elapsed");
  }
  function startupStillAdmitted(): boolean {
    const state = runtime.snapshot();
    return state.state === "starting" && state.failure === null;
  }
  const expectedRole = coreDatabaseRole(env.DATABASE_URL);
  const identity =
    env.CORE_WEB_ORIGIN === ""
      ? undefined
      : createWebIdentityReader({ origin: env.CORE_WEB_ORIGIN, timeoutMs: 1_500, cacheMs: 1_000 });
  let identityUnavailable = false;
  const readWebIdentity: ReadWebIdentity = async (signal) => {
    // Always provide a Core resolver. A missing metadata origin must not select the legacy
    // Next fallback, since reporting the Core build as Web would misstate deployment identity.
    if (identity === undefined) return err("unavailable");
    const result = await identity.read(signal);
    if (result.ok) identityUnavailable = false;
    else if (!identityUnavailable && result.error !== "aborted" && result.error !== "closed") {
      identityUnavailable = true;
      reportCoreDiagnostic(diagnostics, "CORE_WEB_IDENTITY_UNAVAILABLE");
    }
    return result;
  };
  let producer: PgBoss | undefined;
  let closingDatabase = false;
  const ownership = createQueueOperationTracker(() => runtime.markUnavailable("producer"));
  const handler = createTrpcHttpHandler({
    router: appRouter,
    createContext: ({ req }) => {
      const path = new URL(req.url).pathname;
      // Existing actions perform cheap CSRF admission before resolving their actor. Retain
      // that ordering, and avoid a session query for public presentation configuration.
      if (path === "/api/trpc/commands.execute" || path === "/api/trpc/frontend.configuration")
        return Promise.resolve({
          db,
          actor: null,
          session: null,
          csrf: readRequestCsrf(req.headers),
          readWebIdentity,
        });
      return createContext();
    },
  });
  const runtime = createCoreHttpRuntime(
    {
      hostname: env.CORE_HOST,
      port: env.CORE_PORT,
      idleTimeoutSeconds: 120,
      maxRequestBodyBytes: CORE_API_EDGE_BODY_BYTES,
      maxAdmittedBodyBytes: CORE_API_EDGE_BODY_BYTES,
      // SSR and browser prefetch now share this listener. Keep admission finite while
      // allowing an ordinary page's parallel reads alongside its single command.
      maxConcurrentRequests: 32,
      bodyTimeoutMs: 30_000,
      probeTimeoutMs: 1_500,
      probeTtlMs: 1_000,
    },
    {
      serve(options) {
        assertStartupBudget();
        const server = serve(options);
        // Register the actual server even if synchronous bind work exceeded the budget.
        if (performance.now() >= startupDeadlineAt)
          runtime.markUnavailable("startup", "CORE_STARTUP_TIMEOUT");
        return server;
      },
      acceptsPath: acceptsBackendPath,
      handler: (incoming) => {
        const request = admitFrontendRequest(incoming);
        if (request === null)
          return Promise.resolve(
            new Response("Unauthorized proxy", {
              status: 401,
              headers: { "cache-control": "no-store" },
            }),
          );
        return withBackendRequest(
          request,
          () => {
            let path: string;
            try {
              path = decodeURIComponent(new URL(request.url).pathname);
            } catch {
              return Promise.resolve(new Response("Malformed request path", { status: 400 }));
            }
            // The compatibility action transport is single-command. Existing read batching stays
            // available; an uncertain write must never be multiplied or replayed by a batch adapter.
            if (path.includes(",") && path.includes("commands.execute"))
              return Promise.resolve(
                new Response("Commands require individual requests", { status: 400 }),
              );
            return path === "/api/trpc" || path.startsWith("/api/trpc/")
              ? handler(request)
              : handleBackendHttp(request);
          },
          readWebIdentity,
        );
      },
      async startProducer() {
        assertStartupBudget();
        const role = await admitCoreRuntimeRole((configuration) => pool.query(configuration), {
          expectedRole,
          appSchema: "public",
          queueSchema: "pgboss",
          queryTimeoutMs: 5_000,
        });
        if (!role.ok) {
          runtime.markUnavailable("startup", "CORE_DB_ROLE_REJECTED");
          throw new AppError(
            ERROR_IDS.RUNTIME_CORE_API_STARTUP_FAILED,
            "Core runtime role admission failed",
          );
        }
        if (!startupStillAdmitted()) return;
        assertStartupBudget();
        try {
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
        } catch (error) {
          runtime.markUnavailable("producer");
          throw error;
        }
        assertStartupBudget();
      },
      detachProducer: () => setBoss(null),
      async stopProducer() {
        await drainRequestTasks();
        // Startup may visibly time out while its underlying operations are still pending.
        await ownership.waitForSettled();
        await producer?.stop({ graceful: true, timeout: 30_000 });
      },
      async closeDatabase() {
        // Pending/unknown metadata I/O is also part of the owned shutdown, before pool close.
        await identity?.close();
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
      reportDiagnostic(code, facts) {
        reportCoreDiagnostic(diagnostics, code, facts);
      },
    },
  );
  const shutdown = installSignalShutdown({
    source: "core-api",
    timeoutMs: 60_000,
    steps: runtime.shutdownSteps(),
    report(outcome) {
      const codes = {
        drained: "CORE_DRAINED",
        failed: "CORE_DRAIN_FAILED",
        timed_out: "CORE_DRAIN_TIMEOUT",
      } as const satisfies Record<typeof outcome.status, CoreDiagnosticCode>;
      const step = coreDrainStepSchema.safeParse(outcome.step);
      const { state, failure, activeRequests, admittedBodyBytes } = runtime.snapshot();
      reportCoreDiagnostic(diagnostics, codes[outcome.status], {
        state,
        failure: failure ?? undefined,
        activeRequests,
        admittedBodyBytes,
        step: step.data,
      });
      console.warn(JSON.stringify(outcome));
    },
  });
  pool.on("error", () => {
    if (!closingDatabase) runtime.markUnavailable("database");
  });
  // One controller owns cleanup; startup expiry never races a separate close-pool chain.
  const startupDeadline = setTimeout(
    () => runtime.markUnavailable("startup", "CORE_STARTUP_TIMEOUT"),
    45_000,
  );
  const starting = runtime.start().finally(() => clearTimeout(startupDeadline));
  void starting.catch(() => {
    void shutdown.request();
  });
  return { runtime, shutdown, starting };
}
