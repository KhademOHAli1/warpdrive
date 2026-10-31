import { and, eq, or, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { importRows } from "@/db/schema";
import type { ErrorReportRow } from "./errorReport";

export async function loadErrorReportRows(
  db: Db,
  batchId: string,
  signal: AbortSignal,
): Promise<ErrorReportRow[]> {
  signal.throwIfAborted();
  return db
    .select({
      rowNumber: importRows.rowNumber,
      raw: importRows.raw,
      errors: importRows.errors,
      warnings: importRows.warnings,
    })
    .from(importRows)
    .where(
      and(
        eq(importRows.batchId, batchId),
        or(
          sql`${importRows.status} in ('invalid', 'failed')`,
          and(eq(importRows.status, "imported"), sql`${importRows.warnings} <> '[]'::jsonb`),
        ),
      ),
    )
    .orderBy(importRows.rowNumber);
}
