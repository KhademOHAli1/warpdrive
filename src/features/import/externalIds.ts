import { and, eq, inArray } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { ImportSource } from "@/constants/importSources";
import { importExternalIds } from "@/db/schema";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import type { ImportActor } from "./commit";
import type { RowError } from "./commitHelpers";
import { liveVisibility } from "./recordVisibility";
import type { ImportTarget } from "./wizardState";

export type MappedEntity = "person" | "organization" | "deal" | "activity" | "note";

export interface ImportContext {
  source: ImportSource;
  batchId: string;
  createMissingStages: boolean;
}

export type MappingState =
  | { state: "missing" }
  | { state: "deleted" }
  | { state: "visible"; localId: string }
  | { state: "invisible"; localId: string };

export const LINKED_RECORD_UNAVAILABLE_MESSAGE = "linked record unavailable";

export function mappedEntityFor(target: ImportTarget): MappedEntity | null {
  switch (target) {
    case "person":
    case "organization":
    case "deal":
    case "activity":
    case "note":
      return target;
    case "lead":
      return null;
  }
}

export function linkedRecordUnavailable(field: string): RowError[] {
  const error = new AppError(
    ERROR_IDS.IMPORT_LINKED_RECORD_UNAVAILABLE,
    LINKED_RECORD_UNAVAILABLE_MESSAGE,
    {},
  );
  return [{ field, message: error.message }];
}

export function externalIdUnmapped(field: string, externalId: string): RowError[] {
  const error = new AppError(
    ERROR_IDS.IMPORT_EXTERNAL_ID_UNMAPPED,
    `Pipedrive ID ${externalId} has no mapping and no name to create it from`,
    {},
  );
  return [{ field, message: error.message }];
}

export async function classifyMapping(
  tx: DbOrTx,
  actor: ImportActor,
  source: ImportSource,
  entity: MappedEntity,
  externalId: string,
  signal: AbortSignal,
): Promise<MappingState> {
  signal.throwIfAborted();
  const [mapping] = await tx
    .select({ localId: importExternalIds.localId })
    .from(importExternalIds)
    .where(
      and(
        eq(importExternalIds.source, source),
        eq(importExternalIds.entity, entity),
        eq(importExternalIds.externalId, externalId),
      ),
    );
  if (mapping === undefined) return { state: "missing" };
  const live = await liveVisibility(tx, actor, entity, [mapping.localId], signal);
  const visible = live.get(mapping.localId);
  if (visible === undefined) return { state: "deleted" };
  return { state: visible ? "visible" : "invisible", localId: mapping.localId };
}

export async function writeMapping(
  tx: DbOrTx,
  mapping: {
    source: ImportSource;
    entity: MappedEntity;
    externalId: string;
    localId: string;
    batchId: string;
  },
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  await tx
    .insert(importExternalIds)
    .values(mapping)
    .onConflictDoUpdate({
      target: [importExternalIds.source, importExternalIds.entity, importExternalIds.externalId],
      set: { localId: mapping.localId, batchId: mapping.batchId },
    });
}

export async function deleteMappingsForRecords(
  tx: DbOrTx,
  batchId: string,
  localIds: string[],
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  if (localIds.length === 0) return;
  await tx
    .delete(importExternalIds)
    .where(
      and(eq(importExternalIds.batchId, batchId), inArray(importExternalIds.localId, localIds)),
    );
}

export function externalIdOf(group: Record<string, unknown>): string | null {
  const value = group.pipedriveId;
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}
