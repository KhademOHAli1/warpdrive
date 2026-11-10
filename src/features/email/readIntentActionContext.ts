import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { guardCsrf } from "@/features/identity/actions/shared";
import { createContext } from "@/server/trpc/context";
import { err, ok, type Result } from "@/types/result";
import type { ReadIntentActor } from "./readIntentLifecycle";

export async function readIntentActionActor(
  csrfToken: string | null,
): Promise<Result<ReadIntentActor, AppError>> {
  const csrf = await guardCsrf(csrfToken);
  if (!csrf.ok) return err(new AppError(ERROR_IDS.PERM_DENIED, "csrf check failed"));
  const ctx = await createContext();
  if (ctx.actor === null || ctx.session === null || ctx.session.userId !== ctx.actor.id)
    return err(new AppError(ERROR_IDS.AUTH_LOGIN_REJECTED, "unauthenticated"));
  return ok({
    actor: ctx.actor,
    session: { actorId: ctx.actor.id, sessionId: ctx.session.sessionId },
  });
}
