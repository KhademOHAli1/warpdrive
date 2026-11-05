import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import type { PermSetUser } from "@/features/permissions/effective";
import { buildUuidArray } from "@/features/permissions/sql";
import { hydrateActor } from "@/server/hydrateActor";

export async function lockLocalUsers(db: Db, ids: string[], signal: AbortSignal): Promise<void> {
  await db.execute(
    sql`SELECT id FROM users WHERE id=ANY(${buildUuidArray([...new Set(ids)])}) ORDER BY id FOR NO KEY UPDATE`,
  );
  signal.throwIfAborted();
}

export async function localWorkflowActor(
  db: Db,
  id: string,
  signal: AbortSignal,
  lock: boolean,
): Promise<PermSetUser | null> {
  const row = await db.execute(
    sql`SELECT id FROM users WHERE id=${id}::uuid AND is_active=true AND invited_at IS NULL ${lock ? sql`FOR NO KEY UPDATE` : sql``}`,
  );
  signal.throwIfAborted();
  if (row.rows.length === 0) return null;
  const actor = await hydrateActor(db, id, signal);
  return actor !== null && (actor.type === "admin" || actor.flags.has("workflow.run"))
    ? actor
    : null;
}

export async function localRecipientAvailable(
  db: Db,
  id: string,
  signal: AbortSignal,
  lock: boolean,
): Promise<boolean> {
  const rows = await db.execute(
    sql`SELECT id FROM users WHERE id=${id}::uuid AND is_active=true AND invited_at IS NULL ${lock ? sql`FOR NO KEY UPDATE` : sql``}`,
  );
  signal.throwIfAborted();
  return rows.rows.length === 1;
}
