import { randomInt } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import type { PermSetUser } from "@/features/permissions/effective";
import { err, ok, type Result } from "@/types/result";
import type { StepOutput } from "./runTypes";
import type { WorkflowNode } from "./schemas";
import {
  visibleWorkflowRecordSource,
  type WorkflowRecordSnapshot,
  workflowRecordIdList,
  workflowRecordSnapshot,
  workflowRecordSnapshotSql,
} from "./workflowRecordQuery";
import { type RecordPickConfig, recordPickConfig } from "./workflowRecordQueryContract";

type LookupNode = Pick<WorkflowNode, "id" | "config"> & { version: unknown };
interface PickRunContext {
  workflowId: string;
  simulation: boolean;
}

async function visibleCandidates(
  db: Db,
  actor: PermSetUser,
  config: RecordPickConfig,
  signal: AbortSignal,
) {
  const source = visibleWorkflowRecordSource(config.entity, actor);
  const id = source.field("id");
  const { rows } = await db.execute<{ record: unknown }>(sql`
    SELECT ${workflowRecordSnapshotSql(config.entity, source)} AS record
    FROM ${source.from}
    WHERE ${source.visible} AND ${id} IN (${workflowRecordIdList(config.recordIds)})
    ORDER BY ${id} ASC
    LIMIT ${config.recordIds.length}
  `);
  signal.throwIfAborted();
  const candidates: WorkflowRecordSnapshot[] = [];
  for (const row of rows) {
    const record = workflowRecordSnapshot(config.entity, row.record);
    if (record === null) return err(ERROR_IDS.WORKFLOW_INVALID);
    candidates.push(record);
  }
  return candidates.length === 0 ? err(ERROR_IDS.WORKFLOW_BINDING_MISSING) : ok(candidates);
}

function countValue(raw: unknown): bigint | null {
  return typeof raw === "string" && /^\d{1,19}$/.test(raw) ? BigInt(raw) : null;
}

async function leastLoaded(
  db: Db,
  actor: PermSetUser,
  candidates: readonly WorkflowRecordSnapshot[],
  config: NonNullable<RecordPickConfig["loadBalance"]>,
  signal: AbortSignal,
) {
  const source = visibleWorkflowRecordSource(config.entity, actor);
  const relation = source.field(config.field);
  const { rows } = await db.execute<{ id: string; count: string }>(sql`
    SELECT ${relation} AS id, count(*)::text AS count
    FROM ${source.from}
    WHERE ${source.visible} AND ${relation} IN (${workflowRecordIdList(candidates.map((record) => record.id))})
    GROUP BY ${relation}
  `);
  signal.throwIfAborted();
  const counts = new Map<string, bigint>();
  for (const row of rows) {
    const count = countValue(row.count);
    if (count === null) return err(ERROR_IDS.WORKFLOW_INVALID);
    counts.set(row.id, count);
  }
  let winner: WorkflowRecordSnapshot | undefined;
  let smallest: bigint | undefined;
  for (const candidate of candidates) {
    const count = counts.get(candidate.id) ?? 0n;
    if (smallest === undefined || count < smallest) {
      smallest = count;
      winner = candidate;
    }
  }
  return winner === undefined ? err(ERROR_IDS.WORKFLOW_BINDING_MISSING) : ok(winner);
}

async function roundRobinPosition(
  db: Db,
  node: LookupNode,
  context: PickRunContext,
  profile: string,
  candidateCount: number,
  signal: AbortSignal,
) {
  const { rows } = await db.execute<{ count: string }>(sql`
    SELECT count(*)::text AS count
    FROM workflow_steps s JOIN workflow_runs r ON r.id = s.run_id
    WHERE r.workflow_id = ${context.workflowId}::uuid
      AND r.mode = 'live' AND s.simulated = false
      AND s.node_id = ${node.id} AND s.output ->> '__pickProfile' = ${profile}
  `);
  signal.throwIfAborted();
  const count = countValue(rows[0]?.count);
  return count === null
    ? err(ERROR_IDS.WORKFLOW_INVALID)
    : ok(Number(count % BigInt(candidateCount)));
}

// Runs inside the executor's existing receipt transaction. Draft and published
// simulation use the same current read authority without consuming rotation.
export async function pickWorkflowRecord(
  db: Db,
  actor: PermSetUser,
  node: LookupNode,
  context: PickRunContext,
  signal: AbortSignal,
): Promise<Result<StepOutput, string>> {
  signal.throwIfAborted();
  if (!actor.isActive) return err(ERROR_IDS.WORKFLOW_DENIED);
  const parsed = recordPickConfig.safeParse(node.config);
  if (!parsed.success || node.version !== 1 || !z.uuid().safeParse(context.workflowId).success)
    return err(ERROR_IDS.WORKFLOW_INVALID);
  const config = parsed.data;
  const profile = `record.pick:${node.version}:${config.entity}:ROUND_ROBIN`;
  if (config.strategy === "ROUND_ROBIN" && !context.simulation) {
    // The caller's run-step transaction holds this lock through insertion of its receipt.
    const scope = `workflow-pick:${context.workflowId}:${node.id}:${profile}`;
    await db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${scope}, 0))`);
    signal.throwIfAborted();
  }
  const candidates = await visibleCandidates(db, actor, config, signal);
  if (!candidates.ok) return candidates;
  if (config.strategy === "LOAD_BALANCED") {
    if (config.loadBalance === undefined) return err(ERROR_IDS.WORKFLOW_INVALID);
    return leastLoaded(db, actor, candidates.value, config.loadBalance, signal);
  }
  if (config.strategy === "RANDOM") {
    const picked = candidates.value[randomInt(candidates.value.length)];
    return picked === undefined ? err(ERROR_IDS.WORKFLOW_INVALID) : ok(picked);
  }
  const position = await roundRobinPosition(
    db,
    node,
    context,
    profile,
    candidates.value.length,
    signal,
  );
  if (!position.ok) return position;
  const picked = candidates.value[position.value];
  if (picked === undefined) return err(ERROR_IDS.WORKFLOW_INVALID);
  return ok(context.simulation ? picked : { ...picked, __pickProfile: profile });
}
