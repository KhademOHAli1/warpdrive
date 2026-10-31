import type { ImportRow } from "@/db/schema";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import type { ImportActor } from "./commit";
import { liveVisibility, type ViewableEntity } from "./recordVisibility";
import type { ImportTarget } from "./wizardState";

function idsOf(values: (string | null)[]): string[] {
  return [...new Set(values.filter((v): v is string => v !== null))];
}

async function visibleSet(
  db: DbOrTx,
  actor: ImportActor,
  entity: ViewableEntity,
  ids: string[],
  signal: AbortSignal,
): Promise<Set<string>> {
  const live = await liveVisibility(db, actor, entity, ids, signal);
  return new Set([...live].filter(([, visible]) => visible).map(([id]) => id));
}

function onlyVisible(id: string | null, visible: Set<string>): string | null {
  return id !== null && visible.has(id) ? id : null;
}

export async function projectRowVisibility(
  db: DbOrTx,
  actor: ImportActor,
  target: ImportTarget,
  rows: ImportRow[],
  signal: AbortSignal,
): Promise<ImportRow[]> {
  const primaryIds = idsOf(rows.map((r) => r.createdEntityId));
  const [primary, orgs, people, noteIds] = await Promise.all([
    target === "note"
      ? visibleSet(db, actor, "note", primaryIds, signal)
      : visibleSet(db, actor, target, primaryIds, signal),
    visibleSet(db, actor, "organization", idsOf(rows.map((r) => r.createdOrgId)), signal),
    visibleSet(db, actor, "person", idsOf(rows.map((r) => r.createdPersonId)), signal),
    visibleSet(db, actor, "note", idsOf(rows.map((r) => r.createdNoteId)), signal),
  ]);
  return rows.map((r) => ({
    ...r,
    createdEntityId: onlyVisible(r.createdEntityId, primary),
    createdOrgId: onlyVisible(r.createdOrgId, orgs),
    createdPersonId: onlyVisible(r.createdPersonId, people),
    createdNoteId: onlyVisible(r.createdNoteId, noteIds),
  }));
}
