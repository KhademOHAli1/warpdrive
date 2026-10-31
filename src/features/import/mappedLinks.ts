import type { Result } from "@/types/result";
import { err, ok } from "@/types/result";
import type { ImportActor } from "./commit";
import type { RowError, Tx } from "./commitHelpers";
import { type EntityLink, resolveOrgLink, resolvePersonLink } from "./entityLinks";
import {
  classifyMapping,
  externalIdOf,
  externalIdUnmapped,
  type ImportContext,
  linkedRecordUnavailable,
  type MappedEntity,
  writeMapping,
} from "./externalIds";

type LinkEntity = Extract<MappedEntity, "organization" | "person">;
type LinkResolver = (
  tx: Tx,
  actor: ImportActor,
  group: Record<string, unknown>,
  signal: AbortSignal,
) => Promise<Result<EntityLink, RowError[]>>;

function hasName(group: Record<string, unknown>): boolean {
  return typeof group.name === "string" && group.name.trim() !== "";
}

async function resolveMappedLink(
  tx: Tx,
  actor: ImportActor,
  ctx: ImportContext,
  entity: LinkEntity,
  group: Record<string, unknown>,
  resolve: LinkResolver,
  signal: AbortSignal,
): Promise<Result<EntityLink, RowError[]>> {
  const externalId = externalIdOf(group);
  if (ctx.source !== "pipedrive" || externalId === null) return resolve(tx, actor, group, signal);

  const field = `${entity}.pipedriveId`;
  const mapping = await classifyMapping(tx, actor, ctx.source, entity, externalId, signal);
  if (mapping.state === "visible") return ok({ id: mapping.localId, createdId: null });
  if (mapping.state === "invisible") return err(linkedRecordUnavailable(field));
  if (!hasName(group)) return err(externalIdUnmapped(field, externalId));

  const link = await resolve(tx, actor, group, signal);
  if (link.ok === false) return link;
  await writeMapping(
    tx,
    { source: ctx.source, entity, externalId, localId: link.value.id, batchId: ctx.batchId },
    signal,
  );
  return link;
}

export function resolveMappedOrgLink(
  tx: Tx,
  actor: ImportActor,
  ctx: ImportContext,
  group: Record<string, unknown>,
  signal: AbortSignal,
): Promise<Result<EntityLink, RowError[]>> {
  return resolveMappedLink(tx, actor, ctx, "organization", group, resolveOrgLink, signal);
}

export function resolveMappedPersonLink(
  tx: Tx,
  actor: ImportActor,
  ctx: ImportContext,
  group: Record<string, unknown>,
  signal: AbortSignal,
): Promise<Result<EntityLink, RowError[]>> {
  return resolveMappedLink(tx, actor, ctx, "person", group, resolvePersonLink, signal);
}
