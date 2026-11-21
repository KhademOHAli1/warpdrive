import { guardCsrf } from "@/features/identity/actions/shared";
import { createContext } from "@/server/trpc/context";
import type { LocationsResult } from "./contracts";
import { executeLocationsCommand } from "./service";

export async function executeLocationsAction(
  expectedActorId: string,
  command: unknown,
  csrf: string | null,
): Promise<LocationsResult> {
  if (typeof csrf !== "string" || !(await guardCsrf(csrf)).ok) {
    return { ok: false, error: "unavailable" };
  }
  const { actor, db, session } = await createContext();
  if (actor === null || session === null || actor.id !== expectedActorId) {
    return { ok: false, error: "unavailable" };
  }
  return executeLocationsCommand(db, session, command, AbortSignal.timeout(15_000));
}
