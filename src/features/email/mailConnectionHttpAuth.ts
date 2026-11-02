import type { Db } from "@/db/client";
import { enforceAuthRateLimit } from "@/features/auth/better/rateLimit";
import { resolveWorkflowSession } from "@/features/auth/better/sessionPolicy";
import { err, ok } from "@/types/result";

export async function resolveMailboxHttpContext(
  db: Db,
  request: Request,
  signal: AbortSignal,
  write: boolean,
  rateLimit: typeof enforceAuthRateLimit = enforceAuthRateLimit,
) {
  const session = await resolveWorkflowSession(db, request.headers, signal, {
    requireFresh: write,
  });
  const active =
    session ?? (write ? await resolveWorkflowSession(db, request.headers, signal) : null);
  const allowed = await rateLimit(
    db,
    request.headers,
    write ? "/mail-connections/write" : "/security/snapshot",
    active === null ? undefined : `mail-connections:${active.user.id}`,
    signal,
  );
  if (!allowed) return err({ error: "rate_limit" as const, status: 429 });
  if (session === null)
    return active === null
      ? err({ error: "permission" as const, status: 401 })
      : err({ error: "fresh_auth_required" as const, status: 403 });
  return ok({ actorId: session.user.id, sessionId: session.session.id });
}
