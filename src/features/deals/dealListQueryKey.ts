import type { DateFilterContext } from "@/features/saved-filters/datePresetRange";
import { hasDateCondition } from "@/features/saved-filters/filterFields";
import type { FilterDefinition } from "@/features/saved-filters/schemas";

export const DEAL_LIST_QUERY_ROOT = "deal-list";

export function dateFilterContextKey(context: DateFilterContext): string {
  return JSON.stringify([
    context.calendar ?? "gregory",
    context.locale ?? "en",
    context.timeZone ?? "UTC",
  ]);
}

export function dealListQueryKey(
  pipelineId: string,
  variant: string,
  definition: FilterDefinition | undefined,
  context: DateFilterContext,
): readonly unknown[] {
  const key = [DEAL_LIST_QUERY_ROOT, pipelineId, variant, definition ?? "none"];
  return hasDateCondition(definition) ? [...key, dateFilterContextKey(context)] : key;
}
