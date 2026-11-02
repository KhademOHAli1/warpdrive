import type { privacyCases } from "@/db/schema";
import { err, type Result } from "@/types/result";

type CaseRow = typeof privacyCases.$inferSelect;
export function privacyCaseSummary(row: CaseRow) {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    version: row.version,
    receivedAt: row.receivedAt,
  };
}
export type PrivacyCaseSummary = ReturnType<typeof privacyCaseSummary>;

function isStorageFailure(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if (
    error instanceof Error &&
    [
      "timeout exceeded when trying to connect",
      "Connection terminated unexpectedly",
      "Connection terminated due to connection timeout",
      "Connection terminated",
    ].includes(error.message)
  )
    return true;
  if ("code" in error && typeof error.code === "string")
    return (
      /^[0-9A-Z]{5}$/.test(error.code) ||
      ["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EPIPE"].includes(error.code)
    );
  return error instanceof Error && error.cause !== undefined && isStorageFailure(error.cause);
}

// Never turn cancellation into an ordinary retry, and never include driver payloads in a DTO.
export async function privacyStorageOperation<R extends Result<unknown, unknown>>(
  signal: AbortSignal,
  operation: () => Promise<R>,
): Promise<R | { ok: false; error: "storage_unavailable" }> {
  signal.throwIfAborted();
  try {
    return await operation();
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof Error && error.name === "AbortError") throw error;
    if (!isStorageFailure(error)) throw error;
    return err("storage_unavailable" as const);
  }
}
