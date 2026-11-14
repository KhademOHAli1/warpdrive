import type { ActionResult } from "@/types/actionResult";

// Runs `action` for every id in parallel and returns the ids whose action failed, so the caller can
// keep exactly those selected instead of silently dropping the partial failure (mirrors PeopleList's
// bulk-delete semantics).
export async function runBulk(
  ids: readonly string[],
  action: (threadId: string) => Promise<ActionResult<{ threadId: string }>>,
): Promise<string[]> {
  const outcomes = await Promise.all(ids.map(async (id) => ({ id, result: await action(id) })));
  return outcomes.filter((o) => !o.result.ok).map((o) => o.id);
}
