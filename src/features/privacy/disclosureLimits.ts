export const MAX_DISCLOSURE_CATEGORIES = 128;
export const MAX_DISCLOSURE_FILES = 10_000;
export const MAX_DISCLOSURE_REFERENCES = 40_000;

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

interface Budget {
  files: number;
  references: number;
}

function countCategory(category: unknown, budget: Budget, signal: AbortSignal): boolean {
  const item = object(category);
  const ids: unknown = item?.recordIds;
  if (Array.isArray(ids)) budget.references += ids.length;
  if (budget.references > MAX_DISCLOSURE_REFERENCES) return false;
  const entries: unknown = item?.files;
  if (!Array.isArray(entries)) return true;
  budget.files += entries.length;
  if (budget.files > MAX_DISCLOSURE_FILES) return false;
  for (const entry of entries) {
    signal.throwIfAborted();
    const recordIds = object(entry)?.recordIds;
    if (Array.isArray(recordIds)) budget.references += recordIds.length;
    if (budget.references > MAX_DISCLOSURE_REFERENCES) return false;
  }
  return true;
}

function countCategories(
  value: unknown,
  property: string,
  budget: Budget,
  signal: AbortSignal,
): boolean {
  const categories = object(value)?.[property];
  if (!Array.isArray(categories)) return true;
  if (categories.length > MAX_DISCLOSURE_CATEGORIES) return false;
  return categories.every((category: unknown) => countCategory(category, budget, signal));
}

// Count container lengths before schema traversal so oversized metadata cannot amplify validation work.
export function disclosureWithinBudget(
  input: unknown,
  context: unknown,
  signal: AbortSignal,
): boolean {
  const budget = { files: 0, references: 0 };
  return (
    countCategories(input, "categories", budget, signal) &&
    countCategories(context, "expectedCategories", budget, signal)
  );
}
