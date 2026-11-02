import { z } from "zod";
import { type AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import type { Deal } from "@/db/schema/deals";
import type { PermSetUser } from "@/features/permissions/effective";
import { err, ok, type Result } from "@/types/result";
import { archiveDeal } from "./archiveDeal";
import { loadEditableDeal } from "./dealAuth";
import { dealSelectionVersions, missingDealVersion } from "./dealVersion";

export const bulkArchiveInput = z.object({
  dealIds: z.array(z.string().uuid()).max(500),
  archived: z.boolean(),
  expectedWriteVersions: z.record(z.string().uuid(), z.string().uuid()),
});
export type BulkArchiveInput = z.infer<typeof bulkArchiveInput>;
export type BulkArchiveRow = {
  dealId: string;
  outcome: "applied" | "conflict" | "skipped" | "not_found";
  deal?: Deal;
};

function archiveFailureOutcome(error: AppError): "conflict" | "not_found" | "skipped" {
  if (error.id === ERROR_IDS.DEAL_PRECONDITION) return "conflict";
  return error.id === ERROR_IDS.DEAL_NOT_FOUND ? "not_found" : "skipped";
}

// Retain the existing outer transaction and per-row best-effort authorization.
// Duplicate IDs are one command, and a conflict never adopts a newer server token.
export async function archiveDeals(
  db: Db,
  actor: PermSetUser,
  raw: BulkArchiveInput,
  signal: AbortSignal,
): Promise<Result<{ count: number; rows: BulkArchiveRow[] }, AppError>> {
  const versionError = missingDealVersion(raw, ["expectedWriteVersions"]);
  if (versionError !== null) return err(versionError);
  const input = bulkArchiveInput.parse(raw);
  const versions = dealSelectionVersions(input.expectedWriteVersions);
  return db.transaction(async (tx) => {
    const rows: BulkArchiveRow[] = [];
    for (const dealId of new Set(input.dealIds.map((id) => id.toLowerCase()))) {
      const editable = await loadEditableDeal(tx, actor, dealId, signal);
      if (!editable.ok) {
        rows.push({
          dealId,
          outcome: editable.error.id === ERROR_IDS.DEAL_NOT_FOUND ? "not_found" : "skipped",
        });
        continue;
      }
      const expectedWriteVersion = versions.get(dealId);
      if (expectedWriteVersion === undefined || expectedWriteVersion === null) {
        rows.push({ dealId, outcome: "conflict" });
        continue;
      }
      const result = await archiveDeal(
        tx,
        actor,
        { dealId, archived: input.archived, expectedWriteVersion },
        signal,
      );
      rows.push(
        result.ok
          ? { dealId, outcome: "applied", deal: result.value }
          : {
              dealId,
              outcome: archiveFailureOutcome(result.error),
            },
      );
      signal.throwIfAborted();
    }
    return ok({ count: rows.filter((row) => row.outcome === "applied").length, rows });
  });
}
