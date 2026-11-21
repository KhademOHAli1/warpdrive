import { and, eq, type SQL, sql } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { err, ok } from "@/types/result";
import { type InternalProjectPrincipal, lockInternalProject, withInternalProjects } from "../access";
import type { ProjectResult } from "../contracts";
import { internalProjectItems } from "../schema";
import { readProjectWorkStructure } from "./catalog";
import type { ProjectWorkStructure } from "./contracts";
import { internalProjectStructureSettings as settings } from "./schema";

type Target = { projectId: string; revision: number };
type CatalogChange = { activeScaleId?: string | null } | null;

export function changeProjectWorkStructure(
  db: Db,
  who: InternalProjectPrincipal,
  { projectId, revision }: Target,
  signal: AbortSignal,
  change: (
    tx: Db,
    before: ProjectWorkStructure,
  ) => ProjectResult<CatalogChange> | Promise<ProjectResult<CatalogChange>>,
) {
  return withInternalProjects<ProjectWorkStructure>(db, who, signal, async (tx, actor) => {
    const access = await lockInternalProject(tx, actor, projectId, "write");
    if (!access.ok) return access;
    if (!access.value.canManageSettings || access.value.summary.archived)
      return err("project_forbidden");
    const before = await readProjectWorkStructure(tx, projectId);
    if (before.revision !== revision || revision >= Number.MAX_SAFE_INTEGER)
      return err("project_conflict");
    const result = await change(tx, before);
    if (!result.ok) return result;
    if (result.value === null) return ok(before);
    const next = {
      revision: revision + 1,
      activeScaleId:
        result.value.activeScaleId === undefined
          ? before.activeScaleId
          : result.value.activeScaleId,
    };
    await tx
      .insert(settings)
      .values({ projectId, ...next })
      .onConflictDoUpdate({ target: settings.projectId, set: next });
    return ok(await readProjectWorkStructure(tx, projectId));
  });
}

export async function bumpStructureItemRevisions(tx: Db, affected: SQL | undefined) {
  if (affected === undefined)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Work Structure item revision update needs scope");
  const items = internalProjectItems;
  const [exhausted] = await tx
    .select({ id: items.id })
    .from(items)
    .where(and(affected, eq(items.revision, Number.MAX_SAFE_INTEGER)))
    .limit(1);
  if (exhausted !== undefined) return false;
  await tx
    .update(items)
    .set({ revision: sql`${items.revision} + 1` })
    .where(affected);
  return true;
}
