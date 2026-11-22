import { guardCsrf } from "@/features/identity/actions/shared";
import { createContext } from "@/server/trpc/context";
import { engineeringFailure } from "./errors";
import { executeEngineeringChange } from "./service";

export async function executeEngineeringChangeAction(
  actorId: string,
  command: unknown,
  csrf: string | null,
) {
  if (!(await guardCsrf(csrf)).ok) return engineeringFailure("unavailable");
  const { actor, db, session } = await createContext();
  if (session === null || actor?.id !== actorId) return engineeringFailure("unavailable");
  return executeEngineeringChange(db, session, command, AbortSignal.timeout(25_000));
}
