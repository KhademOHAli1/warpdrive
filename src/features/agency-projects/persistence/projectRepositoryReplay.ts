import { and, eq, sql } from "drizzle-orm";
import { err, ok, type Result } from "@/types/result";
import { authorizeProject } from "./projectRepositoryAccess";
import { agencyProjectRequests } from "./projectRepositoryTables";
import type {
  ProjectReceipt,
  ProjectReplayCodec,
  ProjectReplayContext,
  ProjectReplayInput,
  ProjectReplayOperation,
  ProjectRepositoryError,
  ProjectTransactionContext,
} from "./projectRepositoryTypes";

type RequestRow = typeof agencyProjectRequests.$inferSelect;

export async function lockProjectIntent(
  context: ProjectTransactionContext,
  operation: ProjectReplayOperation,
  intentId: string,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  const key = `agency-project-request:${context.actor.id}:${operation}:${intentId}`;
  // A hash collision only serializes unrelated intents; the physical identity remains the full PK.
  await context.db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
  signal.throwIfAborted();
}

export async function findProjectRequest(
  context: ProjectTransactionContext,
  operation: ProjectReplayOperation,
  intentId: string,
  signal: AbortSignal,
): Promise<RequestRow | null> {
  signal.throwIfAborted();
  const rows = await context.db
    .select()
    .from(agencyProjectRequests)
    .where(
      and(
        eq(agencyProjectRequests.actorUserId, context.actor.id),
        eq(agencyProjectRequests.operation, operation),
        eq(agencyProjectRequests.intentId, intentId),
      ),
    )
    .limit(1)
    .for("update");
  signal.throwIfAborted();
  return rows[0] ?? null;
}

export function replayContext(
  actorUserId: string,
  operation: ProjectReplayOperation,
  intentId: string,
  projectId: string,
  revision: number,
  historyId: string,
): ProjectReplayContext {
  return { actorUserId, operation, intentId, projectId, revision, historyId };
}

export async function replayProjectRequest(
  context: ProjectTransactionContext,
  row: RequestRow,
  input: ProjectReplayInput,
  codec: ProjectReplayCodec,
  signal: AbortSignal,
): Promise<Result<ProjectReceipt, ProjectRepositoryError>> {
  const admission = await authorizeProject(context, row.projectId, "replay", signal);
  if (!admission.ok) return admission;
  // A missing/terminal payload is an existing intent, never permission to repeat the write.
  if (
    row.payloadState !== "retained" ||
    row.privatePayload === null ||
    row.privatePayload.length === 0 ||
    row.keyId === null
  )
    return err("project_unavailable");
  const binding = replayContext(
    row.actorUserId,
    row.operation,
    row.intentId,
    row.projectId,
    row.resultRevision,
    row.historyId,
  );
  const compared = await codec.compare(
    binding,
    { keyId: row.keyId, bytes: row.privatePayload },
    input,
    signal,
  );
  signal.throwIfAborted();
  if (!compared.ok) return compared;
  return compared.value
    ? ok({ projectId: row.projectId, revision: row.resultRevision })
    : err("intent_conflict");
}

export async function storeProjectRequest(
  context: ProjectTransactionContext,
  binding: ProjectReplayContext,
  input: ProjectReplayInput,
  codec: ProjectReplayCodec,
  signal: AbortSignal,
): Promise<Result<ProjectReceipt, ProjectRepositoryError>> {
  signal.throwIfAborted();
  const sealed = await codec.seal(binding, input, signal);
  signal.throwIfAborted();
  if (!sealed.ok) return sealed;
  await context.db.insert(agencyProjectRequests).values({
    actorUserId: binding.actorUserId,
    operation: binding.operation,
    intentId: binding.intentId,
    projectId: binding.projectId,
    resultRevision: binding.revision,
    historyId: binding.historyId,
    payloadState: "retained",
    privatePayload: Buffer.from(sealed.value.bytes),
    keyId: sealed.value.keyId,
  });
  signal.throwIfAborted();
  return ok({ projectId: binding.projectId, revision: binding.revision });
}
