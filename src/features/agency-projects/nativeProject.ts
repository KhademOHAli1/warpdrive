import { sql } from "drizzle-orm";
import { env } from "@/config/env";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { withCurrentAuthority } from "@/features/auth/currentAuthority";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { err, ok, type Result } from "@/types/result";
import { nativeProjectActor, nativeProjectOwner, visibleProjectAnchors } from "./nativeAccess";
import { createProjectReplayCodec } from "./nativeReplay";
import { createProjectRepository } from "./persistence/projectRepository";
import type {
  ProjectAuthorityTransaction,
  ProjectRepositoryError,
} from "./persistence/projectRepositoryTypes";

class ProjectRollback extends AppError {
  constructor(readonly result: Result<never, ProjectRepositoryError>) {
    super(ERROR_IDS.DB_WRITE_FAILED, "Project transaction rolled back");
  }
}

export function createNativeProjectRepository(db: Db, who: NativeSessionRef) {
  const authority: ProjectAuthorityTransaction = {
    async run(signal, work) {
      try {
        return await withCurrentAuthority(db, "read", signal, async (tx) => {
          const initial = await nativeProjectActor(tx, who, signal);
          if (initial === null) return err("project_unavailable");
          // Cover CRM writers that predate the native authority fence, including imports.
          // The short transaction owns these locks before project/intent locks and rechecks after them.
          await tx.execute(
            sql`LOCK TABLE public.deals, public.persons, public.organizations, public.pipelines IN SHARE MODE`,
          );
          const current = await nativeProjectActor(tx, who, signal);
          if (current === null) return err("project_unavailable");
          const result = await work({
            db: tx,
            actor: current.actor,
            authorizeCreate: async (input, activeSignal) => {
              const creator = await nativeProjectActor(tx, who, activeSignal);
              const owner = await nativeProjectOwner(tx, input.ownerUserId, activeSignal);
              if (
                creator === null ||
                owner === null ||
                !(await visibleProjectAnchors(tx, creator.actor, input, activeSignal)) ||
                !(await visibleProjectAnchors(tx, owner.actor, input, activeSignal))
              )
                return err("project_unavailable");
              return ok({ creator: creator.staff, selectedOwner: owner.staff });
            },
            authorizeProject: async (project, _action, activeSignal) => {
              const actor = await nativeProjectActor(tx, who, activeSignal);
              return actor !== null &&
                (await visibleProjectAnchors(tx, actor.actor, project, activeSignal))
                ? ok(undefined)
                : err("project_unavailable");
            },
          });
          if (!result.ok) throw new ProjectRollback(result);
          if ((await nativeProjectActor(tx, who, signal)) === null)
            throw new ProjectRollback(err("project_unavailable"));
          return result;
        });
      } catch (error) {
        if (error instanceof ProjectRollback) {
          signal.throwIfAborted();
          return error.result;
        }
        throw error;
      }
    },
  };
  return createProjectRepository({
    authority,
    codec: createProjectReplayCodec(Buffer.from(env.TOKEN_ENCRYPTION_KEY, "base64")),
  });
}
