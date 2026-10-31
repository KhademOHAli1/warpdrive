import { and, eq, isNull, sql } from "drizzle-orm";
import { deals } from "@/db/schema/deals";
import { lostReasons } from "@/db/schema/lostReasons";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import { applyStatusTransition, type DealPatch } from "./statusTransition";

export type ImportedDealStatus = "open" | "won" | "lost";

export interface ImportedDealHistory {
  status?: ImportedDealStatus | undefined;
  wonTime?: string | undefined;
  lostTime?: string | undefined;
  createdAt?: string | undefined;
  lostReason?: string | undefined;
}

export interface ImportedHistoryWarning {
  field: string;
  message: string;
}

interface BuiltPatch {
  patch: DealPatch;
  warnings: ImportedHistoryWarning[];
}

export function buildImportedHistoryPatch(history: ImportedDealHistory, now: Date): BuiltPatch {
  const patch: DealPatch = {};
  const warnings: ImportedHistoryWarning[] = [];
  const createdAt = history.createdAt === undefined ? undefined : new Date(history.createdAt);
  if (createdAt !== undefined) {
    patch.createdAt = createdAt;
    patch.stageEnteredAt = createdAt;
  }
  const { status } = history;
  if (status === undefined) return { patch, warnings };

  const given = status === "won" ? history.wonTime : history.lostTime;
  const field = status === "won" ? "wonTime" : "lostTime";
  let effective = now;
  if (status !== "open") {
    if (given !== undefined) {
      effective = new Date(given);
    } else {
      effective = createdAt ?? now;
      const source = createdAt === undefined ? "the import time" : "the creation date";
      warnings.push({ field, message: `${field} missing, used ${source}` });
    }
  }
  applyStatusTransition(patch, status, history.lostReason, effective);
  return { patch, warnings };
}

async function matchLostReasonId(
  tx: DbOrTx,
  reason: string,
  signal: AbortSignal,
): Promise<string | null> {
  signal.throwIfAborted();
  const [match] = await tx
    .select({ id: lostReasons.id })
    .from(lostReasons)
    .where(and(isNull(lostReasons.archivedAt), sql`lower(${lostReasons.name}) = lower(${reason})`))
    .limit(1);
  return match?.id ?? null;
}

export async function applyImportedDealHistory(
  tx: DbOrTx,
  dealId: string,
  history: ImportedDealHistory,
  signal: AbortSignal,
): Promise<ImportedHistoryWarning[]> {
  const { patch, warnings } = buildImportedHistoryPatch(history, new Date());
  if (patch.status === "lost" && patch.lostReason !== null && patch.lostReason !== undefined) {
    patch.lostReasonId = await matchLostReasonId(tx, patch.lostReason, signal);
  }
  if (Object.keys(patch).length === 0) return warnings;
  signal.throwIfAborted();
  await tx.update(deals).set(patch).where(eq(deals.id, dealId));
  return warnings;
}
