import { and, asc, desc, eq, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { PGBOSS_QUEUE_RELEASE_EXPORT_INTAKE } from "@/constants/jobNames";
import type { Db } from "@/db/client";
import { withCurrentAuthority } from "@/features/auth/currentAuthority";
import { makeStorageClient, type StorageClient } from "@/features/files/storage";
import { inventoryReleaseArtifacts } from "../schema";
import type { ExportIntakeIssue } from "./contracts";
import { exportSealKey, exportStagingKey } from "./objectKeys";
import {
  lockExportIntakeTarget,
  readExportDraftFingerprint,
  readExportSubmitter,
} from "./releaseTarget";
import {
  inventoryExportAttempts as attempts,
  type ExportJobRow,
  inventoryExportFiles as files,
  inventoryExportJobs as jobs,
} from "./schema";
import { awaitExportStorage, type ReadyExportArtifact, sealExportFiles } from "./workerStorage";

const batchSize = 4;
const cleanupBatchSize = 8;
const clock = sql`clock_timestamp()`;
const temporary = { code: "temporary" } as const;
const unavailable = { code: "unavailable" } as const;
const draftChanged = { code: "draftChanged" } as const;
const conflict = { code: "conflict" } as const;

type Claim = { job: ExportJobRow; attemptId: string };
type Outcome =
  | { kind: "ready"; issue: null }
  | { kind: "failed" | "cancelled"; issue: ExportIntakeIssue };

async function readLockedJob(tx: Db, id: string) {
  const [current] = await tx
    .select({
      job: jobs,
      leaseLive: sql<boolean>`coalesce(${jobs.leaseUntil} > clock_timestamp(), false)`,
      stillRetained: sql<boolean>`coalesce(${jobs.retryUntil} > clock_timestamp(), false)`,
    })
    .from(jobs)
    .where(eq(jobs.id, id))
    .for("update", { skipLocked: true });
  return current;
}

async function finishAttempt(tx: Db, { job, attemptId }: Claim, outcome: Outcome) {
  const ready = outcome.kind === "ready";
  const retryable = outcome.kind === "failed" && outcome.issue.code === "temporary";

  await tx
    .update(attempts)
    .set({
      outcome: outcome.kind,
      issue: outcome.issue,
      finishedAt: clock,
      sealPurgeAfter: ready ? null : sql`clock_timestamp() + interval '1 hour'`,
    })
    .where(eq(attempts.id, attemptId));
  await tx
    .update(jobs)
    .set({
      state: outcome.kind,
      activeAttemptId: null,
      leaseUntil: null,
      failedAttemptId: retryable ? attemptId : null,
      publishedAt: ready ? clock : null,
      stagingPurgeAfter: retryable
        ? null
        : sql`greatest(${jobs.stagingExpiresAt} + interval '15 minutes', clock_timestamp())`,
    })
    .where(eq(jobs.id, job.id));
}

async function claimExport(db: Db, id: string, signal: AbortSignal): Promise<Claim | null> {
  return withCurrentAuthority(db, "read", signal, async (tx) => {
    const current = await readLockedJob(tx, id);
    if (current === undefined) return null;
    const { job, leaseLive, stillRetained } = current;
    if (job.state === "working" && !leaseLive && job.activeAttemptId !== null) {
      await finishAttempt(
        tx,
        { job, attemptId: job.activeAttemptId },
        {
          kind: stillRetained ? "failed" : "cancelled",
          issue: temporary,
        },
      );
      return null;
    }
    if (job.state !== "queued" || !stillRetained) return null;

    const [last] = await tx
      .select({ ordinal: attempts.ordinal })
      .from(attempts)
      .where(eq(attempts.jobId, id))
      .orderBy(desc(attempts.ordinal))
      .limit(1);
    const [attempt] = await tx
      .insert(attempts)
      .values({ jobId: id, ordinal: (last?.ordinal ?? 0) + 1 })
      .returning({ id: attempts.id });
    if (attempt === undefined) {
      throw new AppError(ERROR_IDS.DB_INVARIANT, "Export attempt was not reserved", {});
    }
    await tx
      .update(jobs)
      .set({
        state: "working",
        activeAttemptId: attempt.id,
        leaseUntil: sql`clock_timestamp() + interval '5 minutes'`,
      })
      .where(eq(jobs.id, id));
    return { job, attemptId: attempt.id };
  });
}

async function publicationIssue(
  tx: Db,
  job: ExportJobRow,
  signal: AbortSignal,
): Promise<ExportIntakeIssue | null> {
  if (job.submittedBy === null) return unavailable;
  const actor = await readExportSubmitter(tx, job.submittedBy, signal);
  if (actor === null) return unavailable;
  const target = {
    itemId: job.itemId,
    releaseId: job.releaseId,
    sku: job.sku,
    revision: job.revision,
  };
  const release = await lockExportIntakeTarget(tx, actor, target, "write", signal);
  if (!release.ok) return release.issues[0] ?? unavailable;
  const draft = await readExportDraftFingerprint(tx, target, release.value.qualityPlanVersionId);
  if (draft.fingerprint !== job.draftFingerprint) return draftChanged;
  if (draft.hasBom && job.manifest.files.some(({ kind }) => kind === "manufacturingBom"))
    return conflict;
  return null;
}

function failureOutcome(issue: ExportIntakeIssue): Outcome {
  return {
    kind:
      issue.code === "unavailable" || issue.code === "draftChanged" || issue.code === "wrongTarget"
        ? "cancelled"
        : "failed",
    issue,
  };
}

function isCurrentClaim(current: Awaited<ReturnType<typeof readLockedJob>>, claim: Claim) {
  return (
    current?.job.state === "working" &&
    current.job.activeAttemptId === claim.attemptId &&
    current.leaseLive
  );
}

function postgresLockTimeout(error: unknown): boolean {
  return (
    error instanceof Error &&
    (("code" in error && error.code === "55P03") || postgresLockTimeout(error.cause))
  );
}

async function finishClaim(
  db: Db,
  claim: Claim,
  signal: AbortSignal,
  result: { ok: true; artifacts: ReadyExportArtifact[] } | { ok: false; issue: ExportIntakeIssue },
): Promise<boolean> {
  return withCurrentAuthority(db, "read", signal, async (tx) => {
    // Publishing owns the same product lock as approvals, incumbent uploads and grant changes.
    const issue = result.ok ? await publicationIssue(tx, claim.job, signal) : result.issue;
    const current = await readLockedJob(tx, claim.job.id);
    if (!isCurrentClaim(current, claim)) return false;
    if (issue !== null || !result.ok) {
      await finishAttempt(tx, claim, failureOutcome(issue ?? temporary));
      return true;
    }

    try {
      await tx.transaction(async (savepoint) => {
        await savepoint.insert(inventoryReleaseArtifacts).values(result.artifacts);
      });
    } catch (error) {
      signal.throwIfAborted();
      if (!postgresLockTimeout(error)) throw error;
      await finishAttempt(tx, claim, failureOutcome(temporary));
      return true;
    }
    await finishAttempt(tx, claim, { kind: "ready", issue: null });
    return true;
  });
}

async function runClaim(db: Db, storage: StorageClient, claim: Claim, signal: AbortSignal) {
  const issue = await withCurrentAuthority(db, "read", signal, (tx) =>
    publicationIssue(tx, claim.job, signal),
  );
  if (issue !== null) return finishClaim(db, claim, signal, { ok: false, issue });
  const manifestFiles = await db
    .select()
    .from(files)
    .where(eq(files.jobId, claim.job.id))
    .orderBy(asc(files.ordinal));
  if (manifestFiles.length !== claim.job.manifest.files.length) {
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Queued export files do not match manifest", {});
  }
  const sealed = await sealExportFiles(storage, claim.job, claim.attemptId, manifestFiles, signal);
  return finishClaim(
    db,
    claim,
    signal,
    sealed.ok
      ? { ok: true, artifacts: sealed.value }
      : { ok: false, issue: sealed.issues[0] ?? temporary },
  );
}

export async function processReleaseExportJobs(
  db: Db,
  signal: AbortSignal,
  storage: StorageClient = makeStorageClient(),
): Promise<number> {
  const candidates = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      or(
        and(eq(jobs.state, "queued"), sql`${jobs.retryUntil} > clock_timestamp()`),
        and(eq(jobs.state, "working"), lte(jobs.leaseUntil, clock)),
      ),
    )
    .orderBy(asc(jobs.queuedAt), asc(jobs.id))
    .limit(batchSize);
  let finished = 0;
  for (const { id } of candidates) {
    signal.throwIfAborted();
    try {
      const claim = await claimExport(db, id, signal);
      if (claim !== null && (await runClaim(db, storage, claim, signal))) finished++;
    } catch (error) {
      signal.throwIfAborted();
      // A database lock outside the publication savepoint leaves the current lease
      // for recovery. A commit with no response is resolved from the ledger.
      if (!postgresLockTimeout(error)) throw error;
    }
  }
  return finished;
}

function reservationExpired() {
  return or(
    and(eq(jobs.state, "staging"), lte(jobs.stagingExpiresAt, clock)),
    and(eq(jobs.state, "queued"), lte(jobs.retryUntil, clock)),
    and(eq(jobs.state, "failed"), isNotNull(jobs.failedAttemptId), lte(jobs.retryUntil, clock)),
  );
}

async function cancelExpiredReservations(db: Db, signal: AbortSignal) {
  await withCurrentAuthority(db, "read", signal, async (tx) => {
    const expired = await tx
      .select({ id: jobs.id })
      .from(jobs)
      .where(reservationExpired())
      .orderBy(asc(jobs.stagingExpiresAt), asc(jobs.id))
      .limit(cleanupBatchSize)
      .for("update", { skipLocked: true });
    for (const { id } of expired) {
      signal.throwIfAborted();
      await tx
        .update(jobs)
        .set({
          state: "cancelled",
          failedAttemptId: null,
          stagingPurgeAfter: sql`greatest(${jobs.stagingExpiresAt} + interval '15 minutes', clock_timestamp())`,
        })
        .where(eq(jobs.id, id));
    }
  });
}

async function purgeJobFiles(
  db: Db,
  storage: StorageClient,
  jobId: string,
  getKey: (file: { ordinal: number; artifactId: string }) => string,
  signal: AbortSignal,
) {
  const rows = await db
    .select({ ordinal: files.ordinal, artifactId: files.artifactId })
    .from(files)
    .where(eq(files.jobId, jobId))
    .orderBy(asc(files.ordinal));
  for (const file of rows) {
    signal.throwIfAborted();
    const result = await awaitExportStorage(storage.deleteObject(getKey(file), signal), signal);
    if (!result.ok) return false;
  }
  return true;
}

export async function cleanupReleaseExportJobs(
  db: Db,
  signal: AbortSignal,
  storage: StorageClient = makeStorageClient(),
) {
  await cancelExpiredReservations(db, signal);
  const stage = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(lte(jobs.stagingPurgeAfter, clock), isNull(jobs.stagingPurgedAt)))
    .orderBy(asc(jobs.stagingPurgeAfter), asc(jobs.id))
    .limit(cleanupBatchSize);
  for (const { id } of stage) {
    if (
      await purgeJobFiles(db, storage, id, ({ ordinal }) => exportStagingKey(id, ordinal), signal)
    ) {
      await db
        .update(jobs)
        .set({ stagingPurgedAt: clock })
        .where(and(eq(jobs.id, id), isNull(jobs.stagingPurgedAt)));
    }
  }
  const discarded = await db
    .select({ id: attempts.id, jobId: attempts.jobId, releaseId: jobs.releaseId })
    .from(attempts)
    .innerJoin(jobs, eq(attempts.jobId, jobs.id))
    .where(and(lte(attempts.sealPurgeAfter, clock), isNull(attempts.sealPurgedAt)))
    .orderBy(asc(attempts.sealPurgeAfter), asc(attempts.id))
    .limit(cleanupBatchSize);
  for (const { id, jobId, releaseId } of discarded) {
    if (
      await purgeJobFiles(
        db,
        storage,
        jobId,
        ({ artifactId }) => exportSealKey(releaseId, artifactId, id),
        signal,
      )
    ) {
      await db
        .update(attempts)
        .set({ sealPurgedAt: clock })
        .where(and(eq(attempts.id, id), isNull(attempts.sealPurgedAt)));
    }
  }
}

export async function registerReleaseExportWorker(boss: PgBoss, db: Db): Promise<void> {
  await boss.createQueue(PGBOSS_QUEUE_RELEASE_EXPORT_INTAKE);
  await boss.work(PGBOSS_QUEUE_RELEASE_EXPORT_INTAKE, async () => {
    await processReleaseExportJobs(db, AbortSignal.timeout(45_000));
    await cleanupReleaseExportJobs(db, AbortSignal.timeout(10_000));
  });
  await boss.schedule(PGBOSS_QUEUE_RELEASE_EXPORT_INTAKE, "* * * * *");
}
