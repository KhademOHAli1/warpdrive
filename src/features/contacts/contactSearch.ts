import { or, type SQL, type SQLWrapper, sql } from "drizzle-orm";

// Separate from saved-view filters: a search narrows any AND/OR view without changing its meaning.
// Escape LIKE metacharacters so a typed percent or underscore is treated as ordinary text.
export function contactSearchCondition(
  search: string | undefined,
  columns: readonly SQLWrapper[],
): SQL | undefined {
  const term = search?.trim();
  if (term === undefined || term === "") return undefined;
  const pattern = `%${term.replace(/[\\%_]/g, "\\$&")}%`;
  return or(...columns.map((column) => sql`${column} ILIKE ${pattern} ESCAPE ${"\\"}`));
}
