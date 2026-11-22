import { createHash } from "node:crypto";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { withCurrentAuthority } from "@/features/auth/currentAuthority";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { makeStorageClient, type StorageClient } from "@/features/files/storage";
import type { HydratedActor } from "@/server/hydrateActor";
import { currentInventoryActor } from "../../access";
import { releaseArtifactUploadSpec } from "../artifacts";
import type {
  ExportIntakeBinding,
  ExportIntakeIssueCode,
  ExportIntakeJob,
  ExportIntakeResult,
  ExportManifest,
  PreparedExportIntake,
} from "./contracts";
import { validateExportManifest } from "./manifest";
import { exportStagingKey } from "./objectKeys";
import { projectExportJobs, readExportFiles } from "./projection";
import {
  exportIntakeId,
  exportIntakeTargetInput,
  lockExportIntakeTarget,
  readExportDraftFingerprint,
  readExportSubmitter,
} from "./releaseTarget";
import {
  type ExportFileRow,
  type ExportJobRow,
  inventoryExportAttempts,
  inventoryExportFiles,
  inventoryExportJobs,
  inventoryExportRequests,
} from "./schema";

const commandFields = { target: exportIntakeTargetInput, requestId: exportIntakeId };
const selectJobFields = { ...commandFields, jobId: exportIntakeId };
const prepareInput = z.strictObject({ ...commandFields, manifest: z.unknown() });
const queueInput = z.strictObject(selectJobFields);
const retryInput = z.strictObject({ ...selectJobFields, failedAttemptId: exportIntakeId });
const maxListedJobs = 30;
// Existing Silo signing permits upload for five minutes; leave margin before
// the immutable staging window ends, even when a form is reissued.
const presignWindowMs = 6 * 60 * 1000;

const jobs = inventoryExportJobs;
const receipts = inventoryExportRequests;
type ReceiptKind = typeof receipts.$inferSelect.kind;
type ReceiptInput = z.infer<typeof queueInput>;
type PrepareInput = z.infer<typeof prepareInput>;
type RetryInput = z.infer<typeof retryInput>;
type Scope = { tx: Db; actor: HydratedActor; qualityPlanVersionId: string | null };

class IntakeRollback extends Error {
  constructor(readonly code: ExportIntakeIssueCode) {
    super(code);
  }
}

function failure(code: ExportIntakeIssueCode, file?: string) {
  return { ok: false as const, issues: [file === undefined ? { code } : { code, file }] };
}

function success<T>(value: T): ExportIntakeResult<T> {
  return { ok: true, value };
}

function hash(input: unknown) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function bindingKey({ itemId, releaseId, sku, revision }: ExportIntakeBinding) {
  return [itemId, releaseId, sku, revision];
}

function packageFingerprint(target: ExportIntakeBinding, manifest: ExportManifest) {
  const files = [...manifest.files].sort((a, b) =>
    a.name < b.name ? -1 : Number(a.name > b.name),
  );
  return hash([bindingKey(target), { ...manifest, files }]);
}

function jobMatches(target: ExportIntakeBinding) {
  return and(
    eq(jobs.itemId, target.itemId),
    eq(jobs.releaseId, target.releaseId),
    eq(jobs.sku, target.sku),
    eq(jobs.revision, target.revision),
  );
}

async function withIntakeScope<T>(
  db: Db,
  who: NativeSessionRef,
  target: ExportIntakeBinding,
  mode: "read" | "write",
  signal: AbortSignal,
  action: (scope: Scope) => Promise<ExportIntakeResult<T>>,
): Promise<ExportIntakeResult<T>> {
  try {
    return await withCurrentAuthority(db, "read", signal, async (tx) => {
      const actor = await currentInventoryActor(tx, who, signal);
      if (actor === null) return failure("unavailable");
      const locked = await lockExportIntakeTarget(tx, actor, target, mode, signal);
      if (!locked.ok) return locked;
      const result = await action({
        tx,
        actor,
        qualityPlanVersionId: locked.value.qualityPlanVersionId,
      });
      if ((await currentInventoryActor(tx, who, signal)) === null)
        throw new IntakeRollback("unavailable");
      return result;
    });
  } catch (error) {
    if (error instanceof IntakeRollback) return failure(error.code);
    throw error;
  }
}

export async function readExportIntakeJobs(
  db: Db,
  who: NativeSessionRef,
  raw: unknown,
  signal: AbortSignal,
): Promise<ExportIntakeResult<ExportIntakeJob[]>> {
  const input = exportIntakeTargetInput.safeParse(raw);
  if (!input.success) return failure("wrongTarget");
  return withIntakeScope(db, who, input.data, "read", signal, async ({ tx }) => {
    const entries = await tx
      .select()
      .from(jobs)
      .where(and(jobMatches(input.data), ne(jobs.state, "staging")))
      .orderBy(desc(jobs.submittedAt), desc(jobs.id))
      .limit(maxListedJobs);
    return success(await projectExportJobs(tx, entries));
  });
}

async function databaseNow(tx: Db) {
  const result = await tx.execute<{ now_ms: number }>(sql`
    SELECT extract(epoch FROM clock_timestamp())::double precision * 1000 AS now_ms
  `);
  const current = result.rows[0]?.now_ms;
  if (current === undefined) throw new IntakeRollback("temporary");
  return current;
}

async function lockJob(tx: Db, target: ExportIntakeBinding, id: string) {
  const [job] = await tx
    .select()
    .from(jobs)
    .where(and(jobMatches(target), eq(jobs.id, id)))
    .for("update");
  return job;
}

async function readReceipt(scope: Scope, requestId: string, kind: ReceiptKind) {
  const [row] = await scope.tx
    .select()
    .from(receipts)
    .where(
      and(
        eq(receipts.actorId, scope.actor.id),
        eq(receipts.requestId, requestId),
        eq(receipts.kind, kind),
      ),
    );
  return row;
}

async function storeReceipt(
  { tx, actor }: Scope,
  requestId: string,
  kind: ReceiptKind,
  jobId: string,
  fingerprint: string,
) {
  const [inserted] = await tx
    .insert(receipts)
    .values({ actorId: actor.id, requestId, kind, jobId, fingerprint })
    .onConflictDoNothing()
    .returning({ requestId: receipts.requestId });
  // The product fence serializes decisions for one target. Across products a
  // simultaneous reuse of the operation ID must roll back the losing writes.
  if (inserted === undefined) throw new IntakeRollback("conflict");
}

type Staged = { state: "staging"; job: ExportJobRow; files: ExportFileRow[] };
type Known = Extract<PreparedExportIntake, { state: "known" }>;
type PreparedJob = Staged | Known;

async function knownJob(tx: Db, row: ExportJobRow): Promise<ExportIntakeResult<Known>> {
  const [job] = await projectExportJobs(tx, [row]);
  return job === undefined ? failure("conflict") : success({ state: "known", job });
}

async function readJobResult(
  tx: Db,
  row: ExportJobRow,
): Promise<ExportIntakeResult<ExportIntakeJob>> {
  const known = await knownJob(tx, row);
  return known.ok ? success(known.value.job) : known;
}

async function clearObsoleteStaging(
  { tx, qualityPlanVersionId }: Scope,
  target: ExportIntakeBinding,
  job: ExportJobRow,
): Promise<ExportJobRow> {
  if (job.state !== "staging") return job;
  const draft = await readExportDraftFingerprint(tx, target, qualityPlanVersionId);
  const expired = job.stagingExpiresAt.getTime() <= (await databaseNow(tx));
  if (!expired && draft.fingerprint === job.draftFingerprint) return job;
  const [cancelled] = await tx
    .update(jobs)
    .set({
      state: "cancelled",
      stagingPurgeAfter: sql`${jobs.stagingExpiresAt} + interval '15 minutes'`,
    })
    .where(eq(jobs.id, job.id))
    .returning();
  if (cancelled === undefined) throw new IntakeRollback("temporary");
  return cancelled;
}

async function confirmStaging(scope: Scope, target: ExportIntakeBinding, job: ExportJobRow) {
  const { tx, actor, qualityPlanVersionId } = scope;
  if (job.submittedBy !== actor.id) return failure("conflict");
  const draft = await readExportDraftFingerprint(tx, target, qualityPlanVersionId);
  return draft.fingerprint === job.draftFingerprint ? success(job) : failure("draftChanged");
}

async function preparedJob(
  scope: Scope,
  target: ExportIntakeBinding,
  row: ExportJobRow,
): Promise<ExportIntakeResult<PreparedJob>> {
  const { tx } = scope;
  const job = await clearObsoleteStaging(scope, target, row);
  if (job.state !== "staging") return knownJob(tx, job);
  if (job.submittedBy !== scope.actor.id) return failure("conflict");
  if (job.stagingExpiresAt.getTime() - (await databaseNow(tx)) < presignWindowMs)
    return failure("temporary");
  const files = await readExportFiles(tx, job.id);
  return success({ state: "staging", job, files });
}

function manifestFileMetadata(manifest: ExportManifest) {
  const files: (ExportManifest["files"][number] & { ordinal: number; contentType: string })[] = [];
  for (const [ordinal, file] of manifest.files.entries()) {
    const spec = releaseArtifactUploadSpec(file.kind, file.name, file.sizeBytes);
    if (!spec.ok) return failure(spec.error, file.name);
    files.push({ ...file, ordinal, contentType: spec.value.contentType });
  }
  return success(files);
}

async function insertStagingJob(
  { tx, actor, qualityPlanVersionId }: Scope,
  target: ExportIntakeBinding,
  manifest: ExportManifest,
  fingerprint: string,
): Promise<ExportIntakeResult<ExportJobRow>> {
  const draft = await readExportDraftFingerprint(tx, target, qualityPlanVersionId);
  if (draft.hasBom && manifest.files.some(({ kind }) => kind === "manufacturingBom"))
    return failure("conflict");
  const files = manifestFileMetadata(manifest);
  if (!files.ok) return files;
  const [job] = await tx
    .insert(jobs)
    .values({
      ...target,
      submittedBy: actor.id,
      manifest,
      fingerprint,
      draftFingerprint: draft.fingerprint,
      submittedAt: sql`clock_timestamp()`,
      stagingExpiresAt: sql`clock_timestamp() + interval '30 minutes'`,
    })
    .returning();
  if (job === undefined) throw new IntakeRollback("temporary");
  await tx
    .insert(inventoryExportFiles)
    .values(files.value.map((file) => ({ ...file, jobId: job.id })));
  return success(job);
}

async function findOrCreateJob(
  scope: Scope,
  target: ExportIntakeBinding,
  manifest: ExportManifest,
  fingerprint: string,
) {
  const { tx } = scope;
  const [matching] = await tx
    .select()
    .from(jobs)
    .where(and(jobMatches(target), eq(jobs.fingerprint, fingerprint), ne(jobs.state, "cancelled")))
    .for("update");
  const existing =
    matching === undefined ? undefined : await clearObsoleteStaging(scope, target, matching);
  if (existing !== undefined && existing.state !== "cancelled") return success(existing);
  return insertStagingJob(scope, target, manifest, fingerprint);
}

async function reserveExport(
  scope: Scope,
  { target, requestId, manifest: rawManifest }: PrepareInput,
) {
  const manifest = validateExportManifest(rawManifest, target);
  if (!manifest.ok) return manifest;
  const fingerprint = packageFingerprint(target, manifest.value);
  const receipt = await readReceipt(scope, requestId, "prepare");
  if (receipt !== undefined) {
    if (receipt.fingerprint !== fingerprint) return failure("conflict");
    const job = await lockJob(scope.tx, target, receipt.jobId);
    return job === undefined ? failure("conflict") : preparedJob(scope, target, job);
  }
  const job = await findOrCreateJob(scope, target, manifest.value, fingerprint);
  if (!job.ok) return job;
  const prepared = await preparedJob(scope, target, job.value);
  if (prepared.ok) await storeReceipt(scope, requestId, "prepare", job.value.id, fingerprint);
  return prepared;
}

async function presignFiles(storage: StorageClient, staged: Staged, signal: AbortSignal) {
  const uploads = [];
  for (const { ordinal, contentType, sizeBytes, name } of staged.files) {
    const post = await storage.presignPost(
      exportStagingKey(staged.job.id, ordinal),
      contentType,
      signal,
      sizeBytes,
    );
    if (!post.ok) return failure("temporary", name);
    uploads.push({ name, contentType, post: post.value });
  }
  return success(uploads);
}

export async function prepareExportIntake(
  db: Db,
  who: NativeSessionRef,
  raw: unknown,
  signal: AbortSignal,
  storage?: StorageClient,
): Promise<ExportIntakeResult<PreparedExportIntake>> {
  const input = prepareInput.safeParse(raw);
  if (!input.success) return failure("manifest");
  const { target } = input.data;
  const reserved = await withIntakeScope(db, who, target, "write", signal, (scope) =>
    reserveExport(scope, input.data),
  );
  if (!reserved.ok) return reserved;
  if (reserved.value.state === "known") return success(reserved.value);
  const urls = await presignFiles(storage ?? makeStorageClient(), reserved.value, signal);
  if (!urls.ok) return urls;
  const { job } = reserved.value;
  // Signing can outlive a role change, job transition or a changed draft. Only
  // still-eligible owners receive these credentials.
  return withIntakeScope<PreparedExportIntake>(db, who, target, "write", signal, async (scope) => {
    const current = await lockJob(scope.tx, target, job.id);
    if (current === undefined) return failure("unavailable");
    const prepared = await preparedJob(scope, target, current);
    if (!prepared.ok) return prepared;
    if (prepared.value.state === "known") return success(prepared.value);
    return success({ state: "staging", jobId: job.id, uploads: urls.value });
  });
}

async function queueCandidate(scope: Scope, input: ReceiptInput) {
  const { target, jobId, requestId } = input;
  const prepared = await readReceipt(scope, requestId, "prepare");
  if (prepared?.jobId !== jobId) return failure("conflict");
  const job = await lockJob(scope.tx, target, jobId);
  if (job?.submittedBy !== scope.actor.id) return failure("unavailable");
  if (job.state !== "staging") return success(job);
  if (job.stagingExpiresAt.getTime() <= (await databaseNow(scope.tx))) return failure("temporary");
  return confirmStaging(scope, target, job);
}

async function inspectStaging(storage: StorageClient, staged: Staged, signal: AbortSignal) {
  for (const file of staged.files) {
    const head = await storage.headObject(exportStagingKey(staged.job.id, file.ordinal), signal);
    if (!head.ok) return failure("temporary", file.name);
    if (head.value.size !== file.sizeBytes) return failure("fileSize", file.name);
    if (head.value.contentType !== file.contentType) return failure("fileType", file.name);
  }
  return success(undefined);
}

async function markQueued(scope: Scope, input: ReceiptInput) {
  const candidate = await queueCandidate(scope, input);
  if (!candidate.ok) return candidate;
  const { tx } = scope;
  const { jobId, requestId } = input;
  const fingerprint = hash(["queue", bindingKey(input.target), jobId]);
  const receipt = await readReceipt(scope, requestId, "queue");
  if (receipt !== undefined) {
    if (receipt.fingerprint !== fingerprint || receipt.jobId !== jobId) return failure("conflict");
    return readJobResult(tx, candidate.value);
  }
  const job = candidate.value;
  if (job.state !== "staging") return readJobResult(tx, job);
  const [queued] = await tx
    .update(jobs)
    .set({
      state: "queued",
      queuedAt: sql`clock_timestamp()`,
      retryUntil: sql`clock_timestamp() + interval '24 hours'`,
    })
    .where(eq(jobs.id, job.id))
    .returning();
  if (queued === undefined) throw new IntakeRollback("temporary");
  await storeReceipt(scope, requestId, "queue", job.id, fingerprint);
  return readJobResult(tx, queued);
}

export async function queueExportIntake(
  db: Db,
  who: NativeSessionRef,
  raw: unknown,
  signal: AbortSignal,
  storage?: StorageClient,
): Promise<ExportIntakeResult<ExportIntakeJob>> {
  const parsed = queueInput.safeParse(raw);
  if (!parsed.success) return failure("manifest");
  const input = parsed.data;
  const staged = await withIntakeScope(db, who, input.target, "write", signal, async (scope) => {
    const job = await queueCandidate(scope, input);
    if (!job.ok) return job;
    return success({
      state: "staging" as const,
      job: job.value,
      files: job.value.state === "staging" ? await readExportFiles(scope.tx, job.value.id) : [],
    });
  });
  if (!staged.ok) return staged;
  const inspected = await inspectStaging(storage ?? makeStorageClient(), staged.value, signal);
  if (!inspected.ok) return inspected;
  return withIntakeScope(db, who, input.target, "write", signal, (scope) =>
    markQueued(scope, input),
  );
}

async function findRetryableAttempt({ tx }: Scope, job: ExportJobRow, failedAttemptId: string) {
  if (
    job.state !== "failed" ||
    job.failedAttemptId !== failedAttemptId ||
    job.retryUntil === null ||
    job.retryUntil.getTime() <= (await databaseNow(tx))
  )
    return false;
  const attempt = inventoryExportAttempts;
  const [failed] = await tx
    .select({ outcome: attempt.outcome, issue: attempt.issue })
    .from(attempt)
    .where(and(eq(attempt.id, failedAttemptId), eq(attempt.jobId, job.id)));
  return failed?.outcome === "failed" && failed.issue?.code === "temporary";
}

async function retryFailedJob(scope: Scope, input: RetryInput, signal: AbortSignal) {
  const { target, jobId, requestId, failedAttemptId } = input;
  const { tx, qualityPlanVersionId } = scope;
  const job = await lockJob(tx, target, jobId);
  if (job === undefined) return failure("unavailable");
  const fingerprint = hash(["retry", bindingKey(target), jobId, failedAttemptId]);
  const receipt = await readReceipt(scope, requestId, "retry");
  if (receipt !== undefined) {
    if (receipt.fingerprint !== fingerprint || receipt.jobId !== jobId) return failure("conflict");
    return readJobResult(tx, job);
  }
  if (!(await findRetryableAttempt(scope, job, failedAttemptId))) return failure("conflict");
  if (job.submittedBy === null) return failure("unavailable");
  const submitted = await readExportSubmitter(tx, job.submittedBy, signal);
  if (submitted === null) return failure("unavailable");
  const original = await lockExportIntakeTarget(tx, submitted, target, "write", signal);
  if (!original.ok) return original;
  const draft = await readExportDraftFingerprint(tx, target, qualityPlanVersionId);
  if (draft.fingerprint !== job.draftFingerprint) return failure("draftChanged");

  const [queued] = await tx
    .update(jobs)
    .set({ state: "queued", failedAttemptId: null })
    .where(eq(jobs.id, job.id))
    .returning();
  if (queued === undefined) throw new IntakeRollback("temporary");
  await storeReceipt(scope, requestId, "retry", job.id, fingerprint);
  return readJobResult(tx, queued);
}

export async function retryExportIntake(
  db: Db,
  who: NativeSessionRef,
  raw: unknown,
  signal: AbortSignal,
): Promise<ExportIntakeResult<ExportIntakeJob>> {
  const parsed = retryInput.safeParse(raw);
  if (!parsed.success) return failure("manifest");
  return withIntakeScope(db, who, parsed.data.target, "write", signal, (scope) =>
    retryFailedJob(scope, parsed.data, signal),
  );
}
