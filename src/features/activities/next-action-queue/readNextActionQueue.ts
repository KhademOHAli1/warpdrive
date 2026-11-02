import { randomUUID } from "node:crypto";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import type { PermSetUser } from "@/features/permissions/effective";
import { err, ok, type Result } from "@/types/result";
import { activityAccountPreferences } from "../accountTimeZone";
import { queueEnvelopeSchema } from "./queueRowSchema";
import { queueRow } from "./queueRows";
import { nextActionQueueSql } from "./queueSql";
import type { NextActionQueueInput, NextActionQueuePage } from "./queueTypes";

// The actor and clock are server-owned. This read is not session or mutation admission.
export async function readNextActionQueue(
  db: Db,
  actor: PermSetUser | null,
  input: NextActionQueueInput,
  signal: AbortSignal,
  asOf = new Date(),
): Promise<Result<NextActionQueuePage, AppError>> {
  signal.throwIfAborted();
  if (actor === null || !actor.isActive)
    return err(new AppError(ERROR_IDS.PERM_DENIED, "Not permitted"));
  try {
    const instant = asOf.toISOString();
    const { timeZone } = await activityAccountPreferences(db, actor.id);
    signal.throwIfAborted();
    const result = await db.execute(nextActionQueueSql(actor, input, instant, timeZone));
    signal.throwIfAborted();
    const parsed = queueEnvelopeSchema.safeParse(result.rows[0]);
    if (!parsed.success)
      return err(new AppError(ERROR_IDS.DB_READ_FAILED, "Next actions could not be loaded"));
    const rows = parsed.data.items.map((row) => queueRow(actor, row));
    return ok({
      readId: randomUUID(),
      asOf: instant,
      timeZone,
      scope: input.scope,
      limit: input.limit,
      offset: input.offset,
      total: parsed.data.total,
      counts: { overdue: parsed.data.overdue, missingNextStep: parsed.data.missingNextStep },
      rows,
    });
  } catch {
    signal.throwIfAborted();
    return err(new AppError(ERROR_IDS.DB_READ_FAILED, "Next actions could not be loaded"));
  }
}
