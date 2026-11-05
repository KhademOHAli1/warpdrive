import { and, desc, eq, type SQL, sql } from "drizzle-orm";
import { ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { workflowRuns, workflows, workflowVersions } from "@/db/schema";
import type { PermSetUser } from "@/features/permissions/effective";
import { hydrateActor } from "@/server/hydrateActor";
import { err, ok, type Result } from "@/types/result";
import { canWorkflow } from "./access";
import {
  type RunHistoryCursor,
  readRunHistoryCursor,
  runHistoryCursorFingerprint,
  writeRunHistoryCursor,
} from "./runHistoryCursor";
import {
  type NormalizedRunHistoryPageInput,
  runHistoryPageInputSchema,
} from "./runHistoryPageInput";
import { hydrateRunHistoryRows, runHistorySelection } from "./runHistoryProjection";
import { RUN_HISTORY_PAGE_SIZE, type RunHistoryPage } from "./runHistoryTypes";

// Shared with finite query-plan diagnostics. Only an authorized caller may execute
// this builder, after validating the input and its current-context cursor.
export function buildRunHistoryPageQuery(
  db: Db,
  input: NormalizedRunHistoryPageInput,
  cursor?: RunHistoryCursor,
) {
  const conditions: SQL[] = [eq(workflowRuns.workflowId, input.id)];
  if (input.status !== "all") conditions.push(eq(workflowRuns.status, input.status));
  if (input.mode !== "all") conditions.push(eq(workflowRuns.mode, input.mode));
  if (cursor !== undefined)
    conditions.push(sql`(${workflowRuns.createdAt}, ${workflowRuns.id}) <
      (${cursor.key.createdAt}::timestamptz, ${cursor.key.id}::uuid)`);
  return db
    .select({
      ...runHistorySelection,
      cursorCreatedAt:
        sql<string>`to_char(${workflowRuns.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.as(
          "cursor_created_at",
        ),
    })
    .from(workflowRuns)
    .leftJoin(
      workflowVersions,
      and(
        eq(workflowVersions.id, workflowRuns.versionId),
        eq(workflowVersions.workflowId, workflowRuns.workflowId),
      ),
    )
    .where(and(...conditions))
    .orderBy(desc(workflowRuns.createdAt), desc(workflowRuns.id))
    .limit(RUN_HISTORY_PAGE_SIZE + 1);
}

export async function readRunHistoryPage(
  db: Db,
  actor: PermSetUser,
  signal: AbortSignal,
  raw: unknown,
): Promise<Result<RunHistoryPage, string>> {
  signal.throwIfAborted();
  const parsed = runHistoryPageInputSchema.safeParse(raw);
  if (!parsed.success) return err(ERROR_IDS.WORKFLOW_INVALID);
  const currentActor = await hydrateActor(db, actor.id, signal);
  if (currentActor === null) return err(ERROR_IDS.WORKFLOW_DENIED);
  const input = parsed.data;
  const [workflow] = await db.select().from(workflows).where(eq(workflows.id, input.id)).limit(1);
  signal.throwIfAborted();
  if (workflow === undefined || !canWorkflow(currentActor, "view", workflow.ownerId))
    return err(ERROR_IDS.WORKFLOW_DENIED);
  const fingerprint = runHistoryCursorFingerprint({
    actorId: currentActor.id,
    scope: currentActor.type === "admin" ? "admin" : "owner",
    workflowId: workflow.id,
    ownerId: workflow.ownerId,
    status: input.status,
    mode: input.mode,
    size: RUN_HISTORY_PAGE_SIZE,
  });
  let cursor: RunHistoryCursor | undefined;
  if (input.cursor !== undefined) {
    const decoded = readRunHistoryCursor(input.cursor, fingerprint);
    if (!decoded.ok) return decoded;
    cursor = decoded.value;
  }
  signal.throwIfAborted();
  const rows = await buildRunHistoryPageQuery(db, input, cursor);
  signal.throwIfAborted();
  const shown = rows.slice(0, RUN_HISTORY_PAGE_SIZE);
  const last = shown.at(-1);
  const nextCursor =
    rows.length > RUN_HISTORY_PAGE_SIZE && last !== undefined
      ? writeRunHistoryCursor(fingerprint, { createdAt: last.cursorCreatedAt, id: last.id })
      : null;
  const items = await hydrateRunHistoryRows(db, currentActor, workflow, shown, signal);
  return ok({ items, nextCursor });
}
