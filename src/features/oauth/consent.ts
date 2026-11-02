import { env } from "@/config/env";
import type { Db } from "@/db/client";
import { resolveWorkflowSession } from "@/features/auth/better/sessionPolicy";
import { lockMcpGrants } from "@/features/auth/management/mcpGrants";
import { err, type Result } from "@/types/result";
import { issueAuthCode } from "./authorize";
import { validateMcpResource } from "./resource";

export async function issueSessionAuthCode(
  db: Db,
  headers: Headers,
  binding: Omit<Parameters<typeof issueAuthCode>[1], "userId">,
  signal: AbortSignal,
): Promise<Result<string, "authentication_required" | "invalid_target">> {
  signal.throwIfAborted();
  const resource = validateMcpResource(env.BASE_URL, binding.resource);
  if (!resource.ok) return resource;
  const issued = await db.transaction(
    async (tx): Promise<Result<string, "authentication_required" | "invalid_target">> => {
      await lockMcpGrants(tx, signal);
      signal.throwIfAborted();
      const current = await resolveWorkflowSession(tx, headers, signal, { requireFresh: true });
      signal.throwIfAborted();
      if (current === null) return err("authentication_required");
      return issueAuthCode(
        tx,
        { ...binding, resource: resource.value, userId: current.user.id },
        signal,
      );
    },
  );
  signal.throwIfAborted();
  return issued;
}
