import type { SecurityStatus } from "@/features/auth/better/contracts";
import { statusSchema, workflowRequest } from "@/features/auth/ui/workflowRequest";
import { SIG } from "@/features/identity/actions/sig";
import { err, ok, type Result } from "@/types/result";

export async function loadOwnPrivacySecurity(
  signal: AbortSignal,
): Promise<Result<SecurityStatus | null, "unavailable">> {
  signal.throwIfAborted();
  const bounded = AbortSignal.any([signal, SIG()]);
  try {
    const result = await workflowRequest("status", statusSchema, bounded);
    bounded.throwIfAborted();
    if (result.ok) return ok(result.data);
    return result.error === "SESSION_EXPIRED" ? ok(null) : err("unavailable");
  } catch (cause) {
    bounded.throwIfAborted();
    if (
      typeof cause === "object" &&
      cause !== null &&
      "name" in cause &&
      cause.name === "AbortError"
    )
      throw cause;
    return err("unavailable");
  }
}
