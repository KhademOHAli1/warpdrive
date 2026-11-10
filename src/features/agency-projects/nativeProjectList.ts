import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { withCurrentAuthority } from "@/features/auth/currentAuthority";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { err } from "@/types/result";
import { nativeProjectActor } from "./nativeAccess";
import { projectListRequestSchema } from "./persistence/projectListInput";
import { createProjectListRepository } from "./persistence/projectListRepository";
import type { ProjectListReadPort } from "./persistence/projectListTypes";

export async function listNativeProjects(
  db: Db,
  who: NativeSessionRef,
  raw: unknown,
  signal: AbortSignal,
) {
  const parsed = projectListRequestSchema.safeParse(raw);
  if (!parsed.success) return err("invalid_project_list_input" as const);
  const port: ProjectListReadPort = {
    run: (activeSignal, read) =>
      withCurrentAuthority(db, "read", activeSignal, async (tx) => {
        await tx.execute(
          sql`LOCK TABLE public.deals, public.persons, public.organizations, public.pipelines IN SHARE MODE`,
        );
        const current = await nativeProjectActor(tx, who, activeSignal);
        if (current === null) return err("project_unavailable");
        const actor = current.actor;
        const result = await read({
          db: tx,
          actor,
          crmVisibility: {
            userId: actor.id,
            isAdmin: actor.type === "admin",
            isActive: actor.isActive,
            sessionLive: true,
            groupIds: [...actor.groupIds],
            managedUserIds: [...(actor.managedUserIds ?? [])],
          },
          // Main currently has no activated record-processing restriction adapter. This explicit
          // empty ceiling does not claim restriction, erasure, or case-disclosure qualification.
          privacyCeiling: sql`TRUE`,
        });
        if ((await nativeProjectActor(tx, who, activeSignal)) === null)
          return err("project_unavailable");
        return result;
      }),
  };
  return createProjectListRepository(port).list(parsed.data, signal);
}
