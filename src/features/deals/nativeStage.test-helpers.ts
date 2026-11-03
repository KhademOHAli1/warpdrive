import { eq, sql } from "drizzle-orm";
import type { PoolClient } from "pg";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { deals, permissionSets, stages } from "@/db/schema";
import type { TestDb } from "@/test/db";
import { createNativeDeal } from "./nativeCreate";
import { creationFixture, creationSignal } from "./nativeCreate.test-helpers";
import { nativeStageMoveInput } from "./nativeStageTypes";
export const stageSignal = creationSignal;
export async function nativeStageFixture(h: TestDb, modern = false) {
  const f = await creationFixture(h, modern);
  await h.db
    .update(permissionSets)
    .set({ flags: { "deal.create": true, "deal.edit_own": true } })
    .where(eq(permissionSets.id, f.permissionSetId));
  const made = await createNativeDeal(h.db, f.who, f.input, stageSignal());
  if (!made.ok || made.deal === null)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Missing native stage fixture");
  const [target] = await h.db
    .insert(stages)
    .values({ name: "Qualified", pipelineId: f.pipeline.pipeline.id, order: 1 })
    .returning();
  if (target === undefined) throw new AppError(ERROR_IDS.DB_INVARIANT, "Missing target stage");
  const input = nativeStageMoveInput.parse({
    protocolVersion: 1,
    expectedActorId: f.user.id,
    dealId: made.deal.id,
    pipelineId: f.pipeline.pipeline.id,
    toStageId: target.id,
    expectedWriteVersion: made.deal.writeVersion,
    beforePosition: null,
    afterPosition: null,
  });
  return {
    ...f,
    deal: made.deal,
    target,
    move: input,
    read: { protocolVersion: 1 as const, expectedActorId: f.user.id, dealId: made.deal.id },
  };
}
export type NativeStageFixture = Awaited<ReturnType<typeof nativeStageFixture>>;
export async function stageEffects(h: TestDb, f: NativeStageFixture) {
  const result = await h.pool.query(
    `SELECT
    (SELECT to_jsonb(d) FROM deals d WHERE id=$1) AS deal,
    (SELECT count(*)::int FROM change_logs WHERE entity_id=$1 AND field='stageId') AS audit,
    (SELECT version::int FROM channel_versions WHERE channel=$2) AS channel,
    (SELECT count(*)::int FROM deal_create_operations WHERE actor_id=$3) AS receipts`,
    [f.deal.id, `pipeline:${f.move.pipelineId}`, f.user.id],
  );
  return result.rows[0] as {
    deal: Record<string, unknown> | null;
    audit: number;
    channel: number;
    receipts: number;
  };
}
// Live lock-manager evidence, not transaction-cached pg_stat_activity.
export async function stageWaiter(observer: PoolClient): Promise<number> {
  const end = Date.now() + 1500;
  while (Date.now() < end) {
    const result = await observer.query<{ pid: number; blockers: number[]; owner: number }>(
      "SELECT DISTINCT l.pid, pg_backend_pid() AS owner, pg_blocking_pids(l.pid) AS blockers FROM pg_locks l WHERE NOT l.granted AND l.pid<>pg_backend_pid() AND pg_backend_pid()=ANY(pg_blocking_pids(l.pid))",
    );
    const row = result.rows[0];
    if (row !== undefined && row.blockers.includes(row.owner)) return row.pid;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new AppError(ERROR_IDS.DB_INVARIANT, "No actual native stage waiter observed");
}
export async function storedStage(h: TestDb, id: string) {
  const [row] = await h.db.select().from(deals).where(eq(deals.id, id));
  if (row === undefined) throw new AppError(ERROR_IDS.DB_INVARIANT, "Missing native stage row");
  return row;
}
export async function expireSoon(h: TestDb, f: NativeStageFixture) {
  await h.db.execute(
    sql`UPDATE sessions SET expires_at=clock_timestamp()+interval '700 milliseconds' WHERE id=${f.who.sessionId}`,
  );
}
