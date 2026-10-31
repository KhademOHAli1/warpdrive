import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { ImportSource } from "@/constants/importSources";
import type { DedupMode } from "@/constants/importStatus";
import { importBatches, importRows } from "@/db/schema";
import type { withTestDb } from "@/db/testing";
import type { MappedRow } from "@/types/import";
import type { ImportActor } from "./commit";
import type { ImportTarget } from "./wizardState";

export type TestDb = Parameters<Parameters<typeof withTestDb>[0]>[0];

export function adminActorFor(id: string): ImportActor {
  return {
    id,
    type: "admin",
    isActive: true,
    groupIds: new Set<string>(),
    primaryVisibilityGroupId: null,
    flags: new Set(),
  };
}

export function regularActorFor(id: string): ImportActor {
  return {
    id,
    type: "regular",
    isActive: true,
    groupIds: new Set<string>(),
    primaryVisibilityGroupId: null,
    flags: new Set(["contact.create", "contact.edit_own", "contact.delete_own"]),
  };
}

export async function seedBatchWithRows(
  db: TestDb,
  userId: string,
  opts: {
    source: ImportSource;
    target: ImportTarget;
    rows: MappedRow[];
    status?: "ready" | "completed";
    dedupMode?: DedupMode;
    createMissingStages?: boolean;
  },
): Promise<{ batchId: string; rowIds: string[] }> {
  const [batch] = await db
    .insert(importBatches)
    .values({
      targetEntity: opts.target,
      filename: "f.csv",
      createdBy: userId,
      source: opts.source,
      status: opts.status ?? "ready",
      columnMapping: {
        dedupMode: opts.dedupMode ?? "skip",
        columns: {},
        options: {
          rowNoteFromUnmapped: false,
          createMissingStages: opts.createMissingStages ?? false,
        },
      },
    })
    .returning();
  if (batch === undefined) throw new AppError(ERROR_IDS.DB_INVARIANT, "batch seed failed", {});
  const rowIds: string[] = [];
  for (const [i, mapped] of opts.rows.entries()) {
    const [row] = await db
      .insert(importRows)
      .values({ batchId: batch.id, rowNumber: i + 1, raw: {}, mapped, status: "valid" })
      .returning();
    if (row === undefined) throw new AppError(ERROR_IDS.DB_INVARIANT, "row seed failed", {});
    rowIds.push(row.id);
  }
  return { batchId: batch.id, rowIds };
}

export const personRow = (pipedriveId: string, name: string, extra: Record<string, unknown> = {}) =>
  ({
    primary: { name, pipedriveId, emails: [], phones: [], orgId: null, customFields: {}, ...extra },
  }) satisfies MappedRow;
