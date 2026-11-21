import type { Db } from "@/db/client";
import type { HydratedActor } from "@/server/hydrateActor";
import { err } from "@/types/result";
import { type InternalProjectPrincipal, type InternalProjectAccess, lockInternalProject, withInternalProjects } from "../access";
import type { ProjectResult } from "../contracts";

export function withPlanningProject<T>(
  db: Db,
  session: InternalProjectPrincipal,
  projectId: string,
  mode: "read" | "write",
  signal: AbortSignal,
  operation: (
    tx: Db,
    access: InternalProjectAccess,
    actor: HydratedActor,
  ) => Promise<ProjectResult<T>>,
) {
  return withInternalProjects<T>(db, session, signal, async (tx, actor) => {
    const access = await lockInternalProject(tx, actor, projectId, mode);
    if (!access.ok) return access;
    if (mode === "write" && !access.value.canEdit) return err("project_forbidden");
    return operation(tx, access.value, actor);
  });
}
