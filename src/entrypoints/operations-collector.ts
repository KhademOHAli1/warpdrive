import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { isAbsolute } from "node:path";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { z } from "zod";
import { coreDatabaseRole } from "@/db/corePoolProfile";
import * as schema from "@/db/schema";
import { listenOperationsCollector } from "@/features/operations/collectorSocket";
import { operationsSourceBindingSchema } from "@/features/operations/contracts";
import { sampleNewsletterOperations } from "@/features/operations/newsletterSampler";
import { sampleOperationsQueues } from "@/features/operations/queueSampler";
import {
  reconcileOperationsIncidents,
  recordOperationsBatch,
} from "@/features/operations/repository";
import { OPERATIONS_SOURCE_LIMIT, operationsInvariant } from "@/features/operations/storage";
import { sampleWorkerHeartbeat } from "@/features/operations/workerHeartbeat";
import { installSignalShutdown } from "@/server/runtime/shutdown";

const maximumConfigBytes = 8_192;
const signingKey = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/u)
  .refine((key) => Buffer.from(key, "base64url").toString("base64url") === key);
const configuration = z.strictObject({
  databaseUrl: z.string().min(1).max(2_048),
  socketPath: z.string().min(1).max(100),
  queueSamplerSourceId: operationsSourceBindingSchema.shape.sourceId.optional(),
  workerHeartbeat: z.boolean().default(false),
  newsletterSamplerSourceId: operationsSourceBindingSchema.shape.sourceId.optional(),
  sources: z
    .array(z.strictObject({ binding: operationsSourceBindingSchema, signingKey }))
    .min(1)
    .max(OPERATIONS_SOURCE_LIMIT),
});

function readConfiguration(path: string | undefined) {
  if (path === undefined || !isAbsolute(path))
    operationsInvariant("Private collector config required");
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd);
    if (
      !before.isFile() ||
      before.uid !== process.getuid?.() ||
      before.nlink !== 1 ||
      ![0o400, 0o600].includes(before.mode & 0o7777) ||
      before.size === 0 ||
      before.size > maximumConfigBytes
    )
      operationsInvariant("Private collector config required");
    const bytes = Buffer.alloc(before.size + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const read = readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (read === 0) break;
      offset += read;
    }
    const after = fstatSync(fd);
    if (
      offset !== before.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs
    )
      operationsInvariant("Collector configuration changed");
    const raw: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, offset)),
    );
    return configuration.parse(raw);
  } finally {
    closeSync(fd);
  }
}

async function main() {
  const config = readConfiguration(process.argv[2]);
  const expectedRole = coreDatabaseRole(config.databaseUrl);
  const installationId = config.sources[0]?.binding.installationId;
  const sources = new Map(
    config.sources.map((source) => [
      source.binding.sourceId,
      { ...source, installationId: source.binding.installationId },
    ]),
  );
  if (
    installationId === undefined ||
    sources.size !== config.sources.length ||
    new Set(config.sources.map((source) => source.signingKey)).size !== config.sources.length ||
    config.sources.some((source) => source.binding.installationId !== installationId)
  )
    operationsInvariant("Collector sources require one installation and unique IDs and keys");
  const samplers = new Map<
    string,
    (signal: AbortSignal) => ReturnType<typeof sampleOperationsQueues>
  >();
  if (config.workerHeartbeat && config.queueSamplerSourceId === undefined)
    operationsInvariant("Worker heartbeat requires an enrolled queue sampler");
  if (config.queueSamplerSourceId !== undefined)
    samplers.set(config.queueSamplerSourceId, async (signal) => {
      const observations = await sampleOperationsQueues(pool, signal);
      if (config.workerHeartbeat) observations.push(await sampleWorkerHeartbeat(pool, signal));
      return observations;
    });
  if (config.newsletterSamplerSourceId !== undefined) {
    if (samplers.has(config.newsletterSamplerSourceId))
      operationsInvariant("Each sampler requires its own enrolled source");
    samplers.set(config.newsletterSamplerSourceId, (signal) =>
      sampleNewsletterOperations(db, signal),
    );
  }
  if ([...samplers.keys()].some((id) => !sources.has(id)))
    operationsInvariant("Each sampler requires an enrolled source");

  const pool = new Pool({
    connectionString: config.databaseUrl,
    application_name: "warpdrive-operations-collector",
    max: 2,
    connectionTimeoutMillis: 2_000,
    statement_timeout: 5_000,
    query_timeout: 7_000,
    lock_timeout: 2_000,
    idle_in_transaction_session_timeout: 10_000,
  });
  const db = drizzle(pool, { schema });
  pool.on("error", () => console.warn("Operations collector idle database connection failed"));

  let startupFailed = false;
  const stopping = new AbortController();
  let scheduled: ReturnType<typeof setInterval> | undefined;
  let running: Promise<void> | undefined;
  let cursor: Awaited<ReturnType<typeof reconcileOperationsIncidents>>["nextCursor"] = null;
  const tick = () => {
    if (running !== undefined || stopping.signal.aborted) return;
    running = (async () => {
      const signal = AbortSignal.any([stopping.signal, AbortSignal.timeout(12_000)]);
      cursor = (await reconcileOperationsIncidents(db, signal, cursor ?? undefined)).nextCursor;
      for (const [id, sample] of samplers) {
        const sampler = sources.get(id);
        if (sampler === undefined) operationsInvariant("Sampler source unavailable");
        const [source] = await db
          .select({
            sequence: schema.operationsSources.highestSequence,
          })
          .from(schema.operationsSources)
          .where(
            and(
              eq(schema.operationsSources.id, sampler.binding.sourceId),
              eq(schema.operationsSources.currentGenerationId, sampler.binding.generationId),
              eq(schema.operationsSources.active, true),
            ),
          )
          .limit(1);
        if (source === undefined || source.sequence >= Number.MAX_SAFE_INTEGER)
          operationsInvariant("Sampler source unavailable");
        const observations = await sample(signal);
        const result = await recordOperationsBatch(
          db,
          sampler.binding,
          JSON.stringify({
            schemaVersion: 2,
            generationId: sampler.binding.generationId,
            sequence: source.sequence + 1,
            observedAtMs: Date.now(),
            observations,
          }),
          signal,
        );
        if (!result.ok) console.warn("Operations sample held");
      }
    })()
      .catch(() => {
        if (!stopping.signal.aborted) console.warn("Operations monitoring pass held");
      })
      .finally(() => {
        running = undefined;
      });
  };
  const starting = (async () => {
    const role = await pool.query<{ safe: boolean }>(
      `SELECT current_user = $1 AND session_user = current_user
         AND NOT (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolinherit)
         AND NOT has_schema_privilege(current_user, 'public', 'CREATE')
         AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members WHERE member = oid)
         AS safe
       FROM pg_catalog.pg_roles WHERE rolname = current_user`,
      [expectedRole],
    );
    if (role.rows[0]?.safe !== true)
      operationsInvariant("Restricted collector database role required");
    const active = await db
      .select({
        id: schema.operationsSources.id,
        generationId: schema.operationsSources.currentGenerationId,
        role: schema.operationsSources.role,
      })
      .from(schema.operationsSources)
      .where(
        and(
          eq(schema.operationsSources.installationId, installationId),
          eq(schema.operationsSources.active, true),
        ),
      )
      .limit(OPERATIONS_SOURCE_LIMIT + 1);
    const generations = new Map(active.map((source) => [source.id, source.generationId]));
    if (
      config.sources.some(
        ({ binding }) => generations.get(binding.sourceId) !== binding.generationId,
      )
    )
      operationsInvariant("Collector source has no current enrollment");
    for (const samplerId of samplers.keys()) {
      const row = active.find(({ id }) => id === samplerId);
      if (row?.role !== "application_sampler")
        operationsInvariant("Sampler source has an incorrect role");
    }
    return listenOperationsCollector(config.socketPath, {
      lookupAuthority: (id) => (samplers.has(id) ? null : (sources.get(id) ?? null)),
      write: (binding, body, signal) => recordOperationsBatch(db, binding, body, signal),
    });
  })().catch((error: unknown) => {
    startupFailed = true;
    throw error;
  });
  const shutdown = installSignalShutdown({
    source: "operations-collector",
    timeoutMs: 20_000,
    steps: [
      {
        name: "monitor",
        async run() {
          stopping.abort();
          if (scheduled !== undefined) clearInterval(scheduled);
          await running;
        },
      },
      { name: "collector", run: async () => (await starting.catch(() => null))?.close() },
      { name: "database", run: () => pool.end() },
      {
        name: "startup",
        run() {
          if (startupFailed) operationsInvariant("Collector startup held");
        },
      },
    ],
  });
  try {
    await starting;
    if (!stopping.signal.aborted) {
      scheduled = setInterval(tick, 60_000);
      scheduled.unref();
      tick();
    }
  } catch {
    console.error("Operations collector startup held");
    await shutdown.request();
  }
}

void main().catch(() => {
  console.error("Operations collector startup held");
  process.exitCode = 1;
});
