import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import type { WorkflowV2LibraryEntry } from "@/features/blocks/contracts";
import type { PermSetUser } from "@/features/permissions/effective";
import { hydrateActor } from "@/server/hydrateActor";
import { err, ok } from "@/types/result";
import { canWorkflow } from "../access";
import { V2_ERROR } from "./shared";
export const workflowAllEnginesInputSchema = z.strictObject({
  query: z.string().trim().max(200).default(""),
  archive: z.enum(["active", "archived", "all"]).default("active"),
  status: z.enum(["all", "active", "paused", "draft"]).default("all"),
  limit: z.number().int().min(1).max(100).default(25),
  cursor: z.string().max(1000).optional(),
});
const cursorSchema = z.strictObject({
  at: z.iso.datetime({ offset: true }),
  id: z.uuid(),
  engine: z.union([z.literal(1), z.literal(2)]),
});
function parseCursor(raw: string | undefined) {
  if (raw === undefined) return ok(null);
  try {
    const parsed = cursorSchema.safeParse(
      JSON.parse(Buffer.from(raw, "base64url").toString("utf8")),
    );
    return parsed.success ? ok(parsed.data) : err(V2_ERROR.invalid);
  } catch {
    return err(V2_ERROR.invalid);
  }
}
function libraryFilters(input: z.infer<typeof workflowAllEnginesInputSchema>, actor: PermSetUser) {
  const text = input.query.replace(/[\\%_]/g, "\\$&");
  return sql`(${actor.type === "admin" ? sql`true` : sql`owner_id=${actor.id}::uuid`})
 AND (${input.archive === "all" ? sql`true` : input.archive === "archived" ? sql`archived_at IS NOT NULL` : sql`archived_at IS NULL`})
 AND (${text.length === 0 ? sql`true` : sql`name ILIKE ${`%${text}%`} ESCAPE '\\'`})
 AND (${input.status === "all" ? sql`true` : input.status === "active" ? sql`active` : input.status === "draft" ? sql`published_number IS NULL` : sql`NOT active AND published_number IS NOT NULL`})`;
}
export async function listWorkflowAllEngines(
  db: Db,
  actor: PermSetUser,
  raw: unknown,
  signal: AbortSignal,
) {
  const input = workflowAllEnginesInputSchema.safeParse(raw ?? {});
  if (!input.success) return err(V2_ERROR.invalid);
  const cursorResult = parseCursor(input.data.cursor);
  if (!cursorResult.ok) return cursorResult;
  const cursor = cursorResult.value;
  const current = await hydrateActor(db, actor.id, signal);
  if (current === null || !canWorkflow(current, "view")) return err(V2_ERROR.denied);
  const filters = libraryFilters(input.data, current);
  const union = sql`(SELECT id,1 AS engine,owner_id,name,revision,active,archived_at,published_number,updated_at FROM workflows UNION ALL SELECT id,2 AS engine,owner_id,name,revision,active,archived_at,published_number,updated_at FROM workflows_v2)`;
  const result = await db.execute<{
    id: string;
    engine: 1 | 2;
    owner_id: string;
    name: string;
    revision: number;
    active: boolean;
    archived_at: Date | string | null;
    published_number: number | null;
    updated_at: Date | string;
    cursor_at: string;
  }>(
    sql`SELECT *,to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at FROM ${union} library WHERE ${filters} AND ${cursor === null ? sql`true` : sql`(updated_at,id,engine)<(${cursor.at}::timestamptz,${cursor.id}::uuid,${cursor.engine})`} ORDER BY updated_at DESC,id DESC,engine DESC LIMIT ${input.data.limit + 1}`,
  );
  const count = await db.execute<{ total: string }>(
    sql`SELECT count(*)::text total FROM ${union} library WHERE ${filters}`,
  );
  signal.throwIfAborted();
  const rows: WorkflowV2LibraryEntry[] = result.rows.slice(0, input.data.limit).map((row) => ({
    id: row.id,
    engineVersion: row.engine,
    ownerId: row.owner_id,
    name: row.name,
    revision: row.revision,
    active: row.active,
    archivedAt: row.archived_at === null ? null : new Date(row.archived_at).toISOString(),
    publishedNumber: row.published_number,
    updatedAt: new Date(row.updated_at).toISOString(),
  }));
  const last = rows.at(-1);
  const nextCursor =
    result.rows.length > input.data.limit && last !== undefined
      ? Buffer.from(
          JSON.stringify({
            at: result.rows[input.data.limit - 1]?.cursor_at ?? last.updatedAt,
            id: last.id,
            engine: last.engineVersion,
          }),
        ).toString("base64url")
      : null;
  return ok({ rows, nextCursor, total: Number(count.rows[0]?.total ?? 0) });
}
