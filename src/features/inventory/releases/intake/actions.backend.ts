import type { Db } from "@/db/client";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { guardCsrf } from "@/features/identity/actions/shared";
import { createContext } from "@/server/trpc/context";
import type { ExportIntakeResult } from "./contracts";
import { prepareExportIntake, queueExportIntake, retryExportIntake } from "./service";

async function intakeCommand<T>(
  command: (
    db: Db,
    session: NativeSessionRef,
    raw: unknown,
    signal: AbortSignal,
  ) => Promise<ExportIntakeResult<T>>,
  expectedActorId: string,
  raw: unknown,
  csrf: string | null,
): Promise<ExportIntakeResult<T>> {
  if (typeof csrf !== "string" || !(await guardCsrf(csrf)).ok)
    return { ok: false, issues: [{ code: "unavailable" }] };
  const { actor, db, session } = await createContext();
  if (session === null || actor?.id !== expectedActorId)
    return { ok: false, issues: [{ code: "unavailable" }] };
  return command(db, session, raw, AbortSignal.timeout(25_000));
}

export async function prepareExportIntakeAction(
  actorId: string,
  raw: unknown,
  csrf: string | null,
) {
  return intakeCommand(prepareExportIntake, actorId, raw, csrf);
}

export async function queueExportIntakeAction(actorId: string, raw: unknown, csrf: string | null) {
  return intakeCommand(queueExportIntake, actorId, raw, csrf);
}

export async function retryExportIntakeAction(actorId: string, raw: unknown, csrf: string | null) {
  return intakeCommand(retryExportIntake, actorId, raw, csrf);
}
