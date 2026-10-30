import { eq } from "drizzle-orm";
import type { AppError } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { type ImportBatch, type ImportRow, importRows } from "@/db/schema";
import { ok, type Result } from "@/types/result";
import { loadOwnedBatch, narrowTarget } from "./batchHelpers";
import type { ImportActor } from "./commit";
import { projectRowVisibility } from "./rowVisibility";

export async function getBatch(
  db: Db,
  actor: ImportActor,
  batchId: string,
  signal: AbortSignal,
): Promise<Result<ImportBatch, AppError>> {
  return loadOwnedBatch(db, actor, batchId, signal);
}

export async function listRows(
  db: Db,
  actor: ImportActor,
  batchId: string,
  signal: AbortSignal,
): Promise<Result<ImportRow[], AppError>> {
  const owned = await loadOwnedBatch(db, actor, batchId, signal);
  if (owned.ok === false) return owned;
  const rows = await db
    .select()
    .from(importRows)
    .where(eq(importRows.batchId, batchId))
    .orderBy(importRows.rowNumber);
  const projected = await projectRowVisibility(
    db,
    actor,
    narrowTarget(owned.value.targetEntity),
    rows,
    signal,
  );
  return ok(projected);
}
