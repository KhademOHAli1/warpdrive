import type { MappedRow } from "@/types/import";
import type { ImportActor } from "./commit";
import type { Tx } from "./commitHelpers";
import {
  classifyMapping,
  externalIdOf,
  type ImportContext,
  type MappedEntity,
  mappedEntityFor,
  writeMapping,
} from "./externalIds";
import type { ImportTarget } from "./wizardState";

export interface PrimaryMapping {
  entity: MappedEntity;
  externalId: string;
}

export function primaryMappingFor(
  ctx: ImportContext,
  target: ImportTarget,
  mapped: MappedRow,
): PrimaryMapping | null {
  if (ctx.source !== "pipedrive") return null;
  const entity = mappedEntityFor(target);
  const externalId = externalIdOf(mapped.primary);
  return entity === null || externalId === null ? null : { entity, externalId };
}

export async function mappedLocalId(
  tx: Tx,
  actor: ImportActor,
  ctx: ImportContext,
  mapping: PrimaryMapping,
  signal: AbortSignal,
): Promise<string | null> {
  const state = await classifyMapping(
    tx,
    actor,
    ctx.source,
    mapping.entity,
    mapping.externalId,
    signal,
  );
  return state.state === "visible" || state.state === "invisible" ? state.localId : null;
}

export function recordPrimaryMapping(
  tx: Tx,
  ctx: ImportContext,
  mapping: PrimaryMapping | null,
  localId: string,
  signal: AbortSignal,
): Promise<void> {
  if (mapping === null) return Promise.resolve();
  return writeMapping(
    tx,
    {
      source: ctx.source,
      entity: mapping.entity,
      externalId: mapping.externalId,
      localId,
      batchId: ctx.batchId,
    },
    signal,
  );
}
