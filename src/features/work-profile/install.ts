import type { Db } from "@/db/client";
import { workCatalog } from "./catalog";
import type { Preview, WorkCommand } from "./contracts";
import { fail } from "./errors";
import { installResource } from "./install-resources";
import { lockNativeConfiguration, nativeState } from "./install-state";
import type { WorkActor } from "./policy";
import { preview } from "./preview";
import { installationDto, readTypes } from "./read";
import { type ResourceSnapshot, workInstallations } from "./schema";
import { bumpRevision, fingerprint } from "./storage";
export async function apply(
  db: Db,
  actor: WorkActor,
  input: Extract<WorkCommand, { action: "apply" }>,
  signal: AbortSignal,
) {
  if (!actor.isActive || actor.type !== "admin") fail("forbidden");
  await lockNativeConfiguration(db, signal);
  const p = input.preview;
  let current: Preview;
  try {
    current = await preview(
      db,
      {
        action: "preview",
        requestId: input.requestId,
        presetId: p.presetId,
        locale: p.locale,
        expectedRevision: p.expectedRevision,
        selection: p.selection,
        salesName: p.salesName,
        deliveryName: p.deliveryName,
      },
      signal,
    );
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof Error && error.message === "conflict") fail("preview_stale");
    throw error;
  }
  if (fingerprint(current) !== fingerprint(p)) fail("preview_stale");
  if (current.conflicts.length > 0) fail("conflict");
  const preset = workCatalog(p.locale).find((v) => v.id === p.presetId);
  if (!preset) fail("invalid_input");
  const before = await nativeState(db, signal);
  const refs: Omit<ResourceSnapshot, "snapshot">[] = [];
  for (const operation of current.operations)
    refs.push(await installResource(db, operation, preset, before, signal));
  const after = await nativeState(db, signal);
  const resources = refs.map((r) => ({ ...r, snapshot: resourceSnapshot(after, r.kind, r.id) }));
  const [installation] = await db
    .insert(workInstallations)
    .values({
      actorId: actor.id,
      requestId: input.requestId,
      presetId: p.presetId,
      presetVersion: p.presetVersion,
      resources,
    })
    .returning();
  signal.throwIfAborted();
  if (!installation) fail("unavailable");
  const revision = await bumpRevision(db, signal);
  return {
    installation: installationDto(installation),
    revision,
    workTypes: await readTypes(db, signal),
  };
}
export function resourceSnapshot(
  state: Awaited<ReturnType<typeof nativeState>>,
  kind: ResourceSnapshot["kind"],
  id: string,
) {
  return (
    (kind === "pipeline"
      ? state.pipelines
      : kind === "work_type"
        ? state.types
        : kind === "deal_field"
          ? state.fields
          : state.activities
    ).find((v) => v.id === id) ?? null
  );
}
