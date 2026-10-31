import type { Db } from "@/db/client";
import { resolveWorkflowSession } from "@/features/auth/better/sessionPolicy";
import { lockMcpGrants } from "@/features/auth/management/mcpGrants";
import { err, ok, type Result } from "@/types/result";
import { issueAuthCode } from "./authorize";

export async function issueSessionAuthCode(
  db: Db,
  headers: Headers,
  binding: Omit<Parameters<typeof issueAuthCode>[1], "userId">,
  signal: AbortSignal,
): Promise<Result<string, "authentication_required">> {
  return db.transaction(async (tx) => {
    await lockMcpGrants(tx, signal);
    const current = await resolveWorkflowSession(tx, headers, signal, { requireFresh: true });
    if (current === null) return err("authentication_required");
    return ok(await issueAuthCode(tx, { ...binding, userId: current.user.id }, signal));
  });
}
