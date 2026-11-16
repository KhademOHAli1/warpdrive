import { db } from "@/db/client";
import { resolveWorkflowSession } from "@/features/auth/better/sessionPolicy";
import { headers } from "@/server/request";
import { err, ok, type Result } from "@/types/result";
import { SIG } from "./sig";
export async function requireFreshIdentityAction(): Promise<Result<true, "fresh_auth_required">> {
  const session = await resolveWorkflowSession(db, await headers(), SIG(), { requireFresh: true });
  return session === null ? err("fresh_auth_required") : ok(true);
}
