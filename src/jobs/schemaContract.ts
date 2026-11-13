import { setTimeout as delay } from "node:timers/promises";
import { Pool, type PoolConfig } from "pg";
import { type ConstructorOptions, PgBoss, type SchemaDriftReport } from "pg-boss";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import {
  isManifestQueue,
  QUEUE_CATALOG_ENUM,
  QUEUE_CATALOG_FUNCTIONS,
  QUEUE_CATALOG_TABLES,
  QUEUE_NAMES,
  QUEUE_OPTIONS,
  queueMatchesManifest,
  queueOptionsMatchManifest,
} from "./queueManifest";

export const QUEUE_SCHEMA = "pgboss";
export const QUEUE_SCHEMA_VERSION = 46;
const MIGRATION_TIMEOUT_MS = 180_000;
const READ_TIMEOUT_MS = 5_000;
const MIGRATION_LOCK = "warpdrive:core-migrations";
export type QueueOperationPhase =
  | "query"
  | "reader-close"
  | "admission"
  | "producer-start"
  | "producer-stop";
/** Internal ownership registration: synchronous and non-throwing, before awaiting actual work. */
export type QueueOperationObserver = (
  operation: Promise<unknown>,
  phase: QueueOperationPhase,
) => void;

function ownedOperation<T>(
  operation: Promise<T>,
  phase: QueueOperationPhase,
  observe?: QueueOperationObserver,
): Promise<T> {
  observe?.(operation, phase);
  return operation;
}

type QueueReader = Pick<
  PgBoss,
  "schemaVersion" | "detectSchemaDrift" | "getBamStatus" | "getQueues" | "getQueue"
> & { assertCatalogCoverage(): Promise<void> };

type RuntimeQueueOptions = ConstructorOptions &
  Pick<
    PoolConfig,
    | "query_timeout"
    | "statement_timeout"
    | "lock_timeout"
    | "idle_in_transaction_session_timeout"
    | "keepAlive"
    | "keepAliveInitialDelayMillis"
  >;

function rejectAdmission(): never {
  // No SQL, connection strings, queue names, vendor diagnostics or BAM commands escape.
  throw new AppError(ERROR_IDS.DB_WRITE_FAILED, "Background queue schema admission failed");
}

export function runtimeQueueOptions(role: "app" | "worker"): RuntimeQueueOptions {
  return {
    schema: QUEUE_SCHEMA,
    migrate: false,
    createSchema: false,
    schedule: role === "worker",
    supervise: role === "worker",
    reindex: false,
    persistQueueStats: false,
    connectionTimeoutMillis: READ_TIMEOUT_MS,
    // These are forwarded by pg-boss to its actual pg Pool/Client. A Promise deadline
    // alone cannot end #startingPromise; a read timeout makes pool.query retire the
    // failed connection, including a transport that never returns the server timeout.
    query_timeout: READ_TIMEOUT_MS,
    statement_timeout: READ_TIMEOUT_MS,
    lock_timeout: 2_000,
    idle_in_transaction_session_timeout: READ_TIMEOUT_MS,
    keepAlive: true,
    keepAliveInitialDelayMillis: 1_000,
  };
}

function remainingSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const deadline = AbortSignal.timeout(timeoutMs);
  return signal === undefined ? deadline : AbortSignal.any([signal, deadline]);
}

/** Bound public API calls as well as database-side waits, including an unresponsive transport. */
async function boundedCall<T>(
  operation: Promise<T>,
  signal: AbortSignal,
  timeoutMs = READ_TIMEOUT_MS,
): Promise<T> {
  const bounded = remainingSignal(signal, timeoutMs);
  bounded.throwIfAborted();
  let cancel: () => void = () => undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    const onAbort = () =>
      reject(new AppError(ERROR_IDS.DB_READ_FAILED, "Queue operation timed out"));
    bounded.addEventListener("abort", onAbort, { once: true });
    cancel = () => bounded.removeEventListener("abort", onAbort);
  });
  try {
    return await Promise.race([operation, aborted]);
  } finally {
    cancel();
  }
}

export async function stopUnadmittedBoss(
  boss: PgBoss,
  observe?: QueueOperationObserver,
): Promise<void> {
  const stopping = ownedOperation(
    boss.stop({ graceful: false, timeout: 1_000 }),
    "producer-stop",
    observe,
  );
  await boundedCall(stopping, AbortSignal.timeout(10_000), 10_000);
}

export async function closeMigrationPool(pool: Pool): Promise<void> {
  await boundedCall(pool.end(), AbortSignal.timeout(READ_TIMEOUT_MS));
}

export async function startAdmittedRuntimeBoss(
  boss: PgBoss,
  admit: () => Promise<void>,
  observe?: QueueOperationObserver,
): Promise<void> {
  try {
    const admission = admit();
    observe?.(admission, "admission");
    await boundedCall(admission, AbortSignal.timeout(30_000), 30_000);
    const starting = boss.start();
    observe?.(starting, "producer-start");
    await boundedCall(starting, AbortSignal.timeout(30_000), 30_000);
    installRuntimeQueueAssertions(boss);
  } catch (error) {
    await stopUnadmittedBoss(boss, observe);
    throw error;
  }
}

/** Public read APIs on an unstarted probe: no scheduler, supervisor, registrar or BAM. */
async function withQueueReader<T>(
  connectionString: string,
  read: (reader: QueueReader, pool: Pool) => Promise<T>,
  signal: AbortSignal,
  observe?: QueueOperationObserver,
): Promise<T> {
  let failedRead = false;
  const assertReadable = () => {
    if (failedRead) rejectAdmission();
  };
  const pool = new Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: READ_TIMEOUT_MS,
    query_timeout: READ_TIMEOUT_MS,
    options: "-c statement_timeout=5000 -c lock_timeout=2000 -c default_transaction_read_only=on",
  });
  pool.on("error", () => {
    failedRead = true;
  });
  const probe = new PgBoss({
    ...runtimeQueueOptions("app"),
    registerInstance: false,
    db: {
      async executeSql(text, values) {
        try {
          signal.throwIfAborted();
          const query = pool.query(text, values);
          observe?.(query, "query");
          const result = await query;
          signal.throwIfAborted();
          return result;
        } catch (error) {
          // detectSchemaDrift catches several catalog failures and can still return ok.
          // This latch survives those catches; absence of evidence never admits runtime.
          failedRead = true;
          throw error;
        }
      },
    },
  });
  const reader: QueueReader = {
    schemaVersion: () => ownedOperation(probe.schemaVersion(), "query", observe),
    detectSchemaDrift: () => ownedOperation(probe.detectSchemaDrift(), "query", observe),
    getBamStatus: () => ownedOperation(probe.getBamStatus(), "query", observe),
    getQueues: (names, options) =>
      ownedOperation(probe.getQueues(names, options), "query", observe),
    getQueue: (name) => ownedOperation(probe.getQueue(name), "query", observe),
    assertCatalogCoverage() {
      return ownedOperation(
        (async () => {
          assertReadable();
          await assertQueueCatalogCoverage(pool, signal, observe);
          assertReadable();
        })(),
        "query",
        observe,
      );
    },
  };
  try {
    signal.throwIfAborted();
    return await read(reader, pool);
  } finally {
    const closing = pool.end();
    observe?.(closing, "reader-close");
    await boundedCall(closing, AbortSignal.timeout(READ_TIMEOUT_MS));
    assertReadable();
  }
}

export type QueueCatalogEvidence = {
  columns: { table: string; column: string }[];
  constraints: { table: string; count: number }[];
  functions: {
    name: string;
    arguments: string;
    returns: string;
    language: string;
    volatility: string;
    securityDefiner: boolean;
    definition: string;
  }[];
  enumLabels: { label: string }[];
};

/** Independently require complete, supported readable inputs for the vendor's shape diff. */
export function queueCatalogCoverageMatches(evidence: QueueCatalogEvidence): boolean {
  return (
    Object.entries(QUEUE_CATALOG_TABLES).every(([table, expected]) => {
      const columns = evidence.columns.filter((column) => column.table === table);
      const constraints = evidence.constraints.filter((constraint) => constraint.table === table);
      return (
        columns.length === expected.columns.length &&
        expected.columns.every((name) => columns.some((column) => column.column === name)) &&
        constraints.length === 1 &&
        constraints[0]?.count === expected.constraints
      );
    }) &&
    Object.entries(QUEUE_CATALOG_FUNCTIONS).every(([name, expected]) => {
      const functions = evidence.functions.filter((fn) => fn.name === name);
      const fn = functions[0];
      if (functions.length !== 1 || fn === undefined) return false;
      // SQL-standard RETURN/BEGIN ATOMIC bodies are not dollar-quoted and are skipped by
      // this vendor's function diff. Reject unsupported form rather than treating it as equal.
      const body = /\bAS\s+\$([\w]*)\$([\s\S]*?)\$\1\$/i.exec(fn.definition)?.[2]?.trim();
      return (
        body !== undefined &&
        body !== "" &&
        !fn.securityDefiner &&
        fn.arguments === expected.arguments &&
        fn.returns === expected.returns &&
        fn.language === expected.language &&
        fn.volatility === expected.volatility
      );
    }) &&
    evidence.enumLabels.length === QUEUE_CATALOG_ENUM.length &&
    QUEUE_CATALOG_ENUM.every((label, index) => evidence.enumLabels[index]?.label === label)
  );
}

async function assertQueueCatalogCoverage(
  pool: Pool,
  signal: AbortSignal,
  observe?: QueueOperationObserver,
): Promise<void> {
  const tables = Object.keys(QUEUE_CATALOG_TABLES);
  signal.throwIfAborted();
  const columns = await ownedOperation(
    pool.query<QueueCatalogEvidence["columns"][number]>(
      `
    SELECT c.relname AS "table",a.attname AS "column" FROM pg_attribute a
    JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=$1 AND c.relname=ANY($2::text[]) AND c.relkind IN ('r','p')
      AND a.attnum>0 AND NOT a.attisdropped`,
      [QUEUE_SCHEMA, tables],
    ),
    "query",
    observe,
  );
  signal.throwIfAborted();
  const constraints = await ownedOperation(
    pool.query<QueueCatalogEvidence["constraints"][number]>(
      `
    SELECT c.relname AS "table",count(*)::integer AS count FROM pg_constraint k
    JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=$1 AND c.relname=ANY($2::text[]) AND k.contype<>'n' GROUP BY c.relname`,
      [QUEUE_SCHEMA, tables],
    ),
    "query",
    observe,
  );
  signal.throwIfAborted();
  const functions = await ownedOperation(
    pool.query<QueueCatalogEvidence["functions"][number]>(
      `
    SELECT p.proname AS name,oidvectortypes(p.proargtypes) AS arguments,
      format_type(p.prorettype,NULL) AS returns,l.lanname AS language,p.provolatile AS volatility,
      p.prosecdef AS "securityDefiner",pg_get_functiondef(p.oid) AS definition
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
    WHERE n.nspname=$1 AND p.proname=ANY($2::text[])`,
      [QUEUE_SCHEMA, Object.keys(QUEUE_CATALOG_FUNCTIONS)],
    ),
    "query",
    observe,
  );
  signal.throwIfAborted();
  const enumLabels = await ownedOperation(
    pool.query<{ label: string }>(
      `
    SELECT e.enumlabel AS label FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
    JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname=$1 AND t.typname='job_state'
    ORDER BY e.enumsortorder`,
      [QUEUE_SCHEMA],
    ),
    "query",
    observe,
  );
  if (
    !queueCatalogCoverageMatches({
      columns: columns.rows,
      constraints: constraints.rows,
      functions: functions.rows,
      enumLabels: enumLabels.rows,
    })
  )
    rejectAdmission();
  signal.throwIfAborted();
}

/** Check every condition: drift.ok alone excludes indexes recorded as still building. */
export async function assertQueueSchema(reader: QueueReader, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  if ((await boundedCall(reader.schemaVersion(), signal)) !== QUEUE_SCHEMA_VERSION)
    rejectAdmission();
  signal.throwIfAborted();
  const status = await boundedCall(reader.getBamStatus(), signal);
  if (status.some((entry) => entry.status !== "completed" && entry.count !== 0)) rejectAdmission();
  signal.throwIfAborted();
  const drift = await boundedCall(reader.detectSchemaDrift(), signal);
  if (!drift.ok || drift.building.length !== 0) rejectAdmission();
  await boundedCall(reader.assertCatalogCoverage(), signal);
  signal.throwIfAborted();
  const queues = await boundedCall(reader.getQueues([...QUEUE_NAMES]), signal);
  if (
    queues.length !== QUEUE_NAMES.length ||
    QUEUE_NAMES.some(
      (name) => !queueMatchesManifest(queues.find((queue) => queue.name === name) ?? null),
    )
  )
    rejectAdmission();
  signal.throwIfAborted();
}

/** Admission runs before start, especially before the Worker's internal scheduler starts. */
export async function assertRuntimeQueueSchema(
  connectionString: string,
  signal?: AbortSignal,
  observe?: QueueOperationObserver,
): Promise<void> {
  const bounded = remainingSignal(signal, 30_000);
  try {
    await withQueueReader(
      connectionString,
      (reader) => assertQueueSchema(reader, bounded),
      bounded,
      observe,
    );
  } catch {
    rejectAdmission();
  }
}

/**
 * Feature registrars/producers retain createQueue's public shape, but runtime calls only
 * assert the pre-provisioned manifest. Stock pg-boss scheduler uses its own manager and
 * still issues one idempotent INSERT on the existing __pgboss__send-it queue. It requires
 * queue INSERT privilege; this guard is source policy, not database-enforced queue names.
 */
export function installRuntimeQueueAssertions(boss: PgBoss): void {
  boss.createQueue = async (name, options) => {
    if (!isManifestQueue(name) || !queueOptionsMatchManifest(options)) rejectAdmission();
    if (!queueMatchesManifest(await boundedCall(boss.getQueue(name), AbortSignal.timeout(5_000))))
      rejectAdmission();
  };
}

/** Only recorded index builds may be incomplete on an explicitly retried migration. */
export function queueMigrationDriftIsRecoverable(drift: SchemaDriftReport): boolean {
  return (
    drift.missingTables.length === 0 &&
    drift.missing.length === 0 &&
    drift.invalid.every((index) => index.building) &&
    drift.mismatched.length === 0 &&
    drift.missingFunctions.length === 0 &&
    drift.mismatchedFunctions.length === 0 &&
    drift.columnDrift.length === 0 &&
    drift.constraintDrift.length === 0 &&
    drift.enumDrift === null
  );
}

/** Reject future/unsupported/partial installs before any application or queue mutation. */
export async function inspectQueueMigrationSource(
  connectionString: string,
  signal: AbortSignal,
): Promise<void> {
  await withQueueReader(
    connectionString,
    async (reader, pool) => {
      const schemas = await pool.query<{ nspname: string }>(
        "SELECT nspname FROM pg_namespace WHERE lower(nspname) = $1",
        [QUEUE_SCHEMA],
      );
      if (schemas.rows.some((schema) => schema.nspname !== QUEUE_SCHEMA)) rejectAdmission();
      if (schemas.rows.length === 0) return;
      const versionTable = await pool.query<{ name: string | null }>(
        "SELECT to_regclass('pgboss.version')::text AS name",
      );
      if (versionTable.rows[0]?.name === null) {
        // A deliberately pre-created empty owner schema is a valid fresh install.
        const objects = await pool.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM pg_depend d JOIN pg_namespace n ON n.oid=d.refobjid WHERE d.refclassid='pg_namespace'::regclass AND n.nspname=$1",
          [QUEUE_SCHEMA],
        );
        if (objects.rows[0]?.count !== "0") rejectAdmission();
        return;
      }
      const version = await boundedCall(reader.schemaVersion(), signal);
      // Only the pinned vendor's current schema and immediately prior schema are supported.
      // A genuine populated45 fixture is required to qualify this path, not a decremented row.
      if (version !== 45 && version !== QUEUE_SCHEMA_VERSION) rejectAdmission();
      if (version === QUEUE_SCHEMA_VERSION) {
        const drift = await boundedCall(reader.detectSchemaDrift(), signal);
        // BAM can recover interrupted work; unrelated drift must never be auto-repaired.
        if (!queueMigrationDriftIsRecoverable(drift)) rejectAdmission();
        await boundedCall(reader.assertCatalogCoverage(), signal);
      }
    },
    signal,
  );
}

export async function waitForQueueBuilds(
  reader: Pick<QueueReader, "getBamStatus">,
  signal: AbortSignal,
): Promise<void> {
  for (;;) {
    signal.throwIfAborted();
    const status = await boundedCall(reader.getBamStatus(), signal);
    // Previous failed rows may need the vendor's first asynchronous retry or stale-build grace.
    // They remain unadmitted until completed; a new failure event aborts this migration below.
    if (!status.some((entry) => entry.status !== "completed" && entry.count !== 0)) return;
    await delay(100, undefined, { signal });
  }
}

/** No application handlers/startup sends/schedules run in the one-shot Migrator. */
export async function migrateQueueSchema(
  connectionString: string,
  signal: AbortSignal,
  verifyPrepared: typeof assertRuntimeQueueSchema = assertRuntimeQueueSchema,
): Promise<void> {
  const failure = new AbortController();
  const bounded = AbortSignal.any([signal, failure.signal]);
  const migrationOptions: RuntimeQueueOptions = {
    ...runtimeQueueOptions("app"),
    connectionString,
    schema: QUEUE_SCHEMA,
    migrate: true,
    createSchema: true,
    schedule: false,
    supervise: false,
    reindex: false,
    persistQueueStats: false,
    registerInstance: false,
    max: 2,
    connectionTimeoutMillis: READ_TIMEOUT_MS,
    query_timeout: 35_000,
    statement_timeout: 30_000,
    options: "-c statement_timeout=30000 -c lock_timeout=2000",
  };
  const boss = new PgBoss(migrationOptions);
  // Observed before start; vendor diagnostics may contain SQL/credentials.
  boss.on("error", () => {
    try {
      console.error("pg-boss migration background error", {
        code: "queue_migration_background_error",
      });
    } catch {
      // Preserve the migration's own failure even if diagnostics are unavailable.
    }
  });
  boss.on("bam", (event) => {
    // Do not inspect/log the event's command/error/name fields.
    if (event.status === "failed") failure.abort();
  });
  try {
    bounded.throwIfAborted();
    await boundedCall(boss.start(), bounded, 35_000);
    for (const name of QUEUE_NAMES) {
      bounded.throwIfAborted();
      await boundedCall(boss.createQueue(name, QUEUE_OPTIONS), bounded);
    }
    await waitForQueueBuilds(boss, bounded);
    // Use the strict read adapter again: the live migrator's stock drift API is best-effort.
    await boundedCall(verifyPrepared(connectionString, bounded), bounded, 30_000);
  } catch {
    rejectAdmission();
  } finally {
    // The vendor cancels/abandons a running BAM build before closing its pool. A failed or
    // interrupted run remains unadmitted; stopping never means the migration completed.
    await stopUnadmittedBoss(boss);
  }
}

/** Serialize both schema phases without nesting pg-boss's self-transactional DDL. */
export async function withCoreMigrationLock<T>(
  connectionString: string,
  operation: (signal: AbortSignal) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const bounded = remainingSignal(signal, MIGRATION_TIMEOUT_MS);
  const pool = new Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: READ_TIMEOUT_MS,
    query_timeout: READ_TIMEOUT_MS,
    options: "-c statement_timeout=5000 -c lock_timeout=2000",
  });
  // This session stays checked out throughout both phases. pg-boss's own locks do not
  // fence already-running producers/consumers; deployment still requires offline DDL.
  const client = await pool.connect().catch(async () => {
    await boundedCall(pool.end(), AbortSignal.timeout(READ_TIMEOUT_MS));
    return rejectAdmission();
  });
  try {
    bounded.throwIfAborted();
    const lock = await client.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock(hashtext($1)) AS acquired",
      [MIGRATION_LOCK],
    );
    if (lock.rows[0]?.acquired !== true) rejectAdmission();
    const result = await operation(bounded);
    bounded.throwIfAborted();
    return result;
  } finally {
    // Destroy this session rather than pooling it, releasing its advisory lock even on failure.
    client.release(true);
    await boundedCall(pool.end(), AbortSignal.timeout(READ_TIMEOUT_MS));
  }
}
