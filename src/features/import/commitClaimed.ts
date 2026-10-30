import type { AppError } from "@/constants/errorIds";
import type { DedupMode } from "@/constants/importStatus";
import type { MappedRow } from "@/types/import";
import type { Result } from "@/types/result";
import type { ImportActor } from "./commit";
import { type Commit, finalize, type Tx } from "./commitHelpers";
import { createWithRelations } from "./commitRelations";
import { applyOneUpdate } from "./commitUpdate";
import { findCandidates } from "./dedup";
import type { ImportContext } from "./externalIds";
import { mappedLocalId, primaryMappingFor, recordPrimaryMapping } from "./primaryMapping";
import type { ImportTarget } from "./wizardState";

export async function commitClaimedRow(
  tx: Tx,
  actor: ImportActor,
  ctx: ImportContext,
  rowId: string,
  target: ImportTarget,
  dedupMode: DedupMode,
  mapped: MappedRow,
  signal: AbortSignal,
): Promise<Result<Commit, AppError>> {
  const mapping = primaryMappingFor(ctx, target, mapped);
  if (mapping !== null) {
    const existingId = await mappedLocalId(tx, actor, ctx, mapping, signal);
    if (existingId !== null) return finalize(tx, rowId, "skipped_duplicate", existingId, []);
  }

  if (target === "person" || target === "organization") {
    const cand = await findCandidates(tx, actor, target, mapped.primary, signal);

    if (cand.outcome === "ambiguous") {
      return finalize(tx, rowId, "invalid", null, [
        { field: "email", message: `ambiguous match: ${cand.count} existing contacts` },
      ]);
    }

    if (cand.outcome === "one") {
      return commitMatched(
        tx,
        actor,
        ctx,
        rowId,
        target,
        dedupMode,
        mapped,
        cand.candidateId,
        signal,
      );
    }
  }

  const created = await createWithRelations(tx, actor, target, mapped, ctx, signal);
  if (created.ok === false) {
    return finalize(tx, rowId, "invalid", null, created.error);
  }
  await recordPrimaryMapping(tx, ctx, mapping, created.value.entityId, signal);
  return finalize(
    tx,
    rowId,
    "imported",
    created.value.entityId,
    [],
    created.value.side,
    created.value.warnings,
  );
}

async function commitMatched(
  tx: Tx,
  actor: ImportActor,
  ctx: ImportContext,
  rowId: string,
  target: "person" | "organization",
  dedupMode: DedupMode,
  mapped: MappedRow,
  candidateId: string,
  signal: AbortSignal,
): Promise<Result<Commit, AppError>> {
  const mapping = primaryMappingFor(ctx, target, mapped);
  if (dedupMode === "skip") {
    await recordPrimaryMapping(tx, ctx, mapping, candidateId, signal);
    return finalize(tx, rowId, "skipped_duplicate", candidateId, []);
  }
  const updated = await applyOneUpdate(tx, actor, target, candidateId, mapped, ctx, rowId, signal);
  if (updated.ok && updated.value.status === "imported") {
    await recordPrimaryMapping(tx, ctx, mapping, candidateId, signal);
  }
  return updated;
}
