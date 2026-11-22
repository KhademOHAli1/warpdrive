import { and, asc, eq, inArray, isNotNull, lte, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import type { ExportIntakeBinding, ExportIntakeJob } from "./contracts";
import { type ExportJobRow, inventoryExportAttempts, inventoryExportFiles } from "./schema";

const maxAttemptsPerJob = 40;

export function exportJobBinding(job: ExportJobRow): ExportIntakeBinding {
  return { itemId: job.itemId, releaseId: job.releaseId, sku: job.sku, revision: job.revision };
}

export async function readExportFiles(tx: Db, jobId: string) {
  const file = inventoryExportFiles;
  return tx.select().from(file).where(eq(file.jobId, jobId)).orderBy(asc(file.ordinal));
}

async function readRecentAttempts(tx: Db, ids: string[]) {
  const attempt = inventoryExportAttempts;
  const ranked = tx
    .select({
      id: attempt.id,
      jobId: attempt.jobId,
      finishedAt: attempt.finishedAt,
      outcome: attempt.outcome,
      issue: attempt.issue,
      ordinal: attempt.ordinal,
      position:
        sql<number>`row_number() OVER (PARTITION BY ${attempt.jobId} ORDER BY ${attempt.ordinal} DESC)`.as(
          "position",
        ),
    })
    .from(attempt)
    .where(and(inArray(attempt.jobId, ids), isNotNull(attempt.finishedAt)))
    .as("ranked_export_attempts");
  return tx
    .select()
    .from(ranked)
    .where(lte(ranked.position, maxAttemptsPerJob))
    .orderBy(asc(ranked.ordinal));
}

export async function projectExportJobs(tx: Db, jobs: ExportJobRow[]): Promise<ExportIntakeJob[]> {
  const published = jobs.flatMap((job) => (job.state === "ready" ? [job.id] : []));
  const [attempts, files] = await Promise.all([
    jobs.length === 0
      ? []
      : readRecentAttempts(
          tx,
          jobs.map(({ id }) => id),
        ),
    published.length === 0
      ? []
      : tx
          .select()
          .from(inventoryExportFiles)
          .where(inArray(inventoryExportFiles.jobId, published))
          .orderBy(asc(inventoryExportFiles.ordinal)),
  ]);
  const history = new Map<string, ExportIntakeJob["attempts"]>();
  for (const { id, jobId, finishedAt, outcome, issue } of attempts) {
    if (finishedAt === null || outcome === null) continue;
    const entries = history.get(jobId) ?? [];
    entries.push({ id, at: finishedAt.toISOString(), outcome, issue });
    history.set(jobId, entries);
  }
  const artifacts = new Map<string, ExportIntakeJob["artifacts"]>();
  for (const { jobId, artifactId, name, kind, sha256 } of files) {
    const entries = artifacts.get(jobId) ?? [];
    entries.push({ id: artifactId, name, kind, sha256 });
    artifacts.set(jobId, entries);
  }
  return jobs.flatMap((job) =>
    job.state === "staging"
      ? []
      : [
          {
            id: job.id,
            submittedAt: job.submittedAt.toISOString(),
            target: exportJobBinding(job),
            manifest: job.manifest,
            state: job.state,
            attempts: history.get(job.id) ?? [],
            artifacts: artifacts.get(job.id) ?? [],
            failedAttemptId: job.failedAttemptId,
          },
        ],
  );
}
