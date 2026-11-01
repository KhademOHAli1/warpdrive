// Client-side view of an AST saved_filters row: the fields the board filter UI needs. The jsonb
// definition is parsed server-side (trpc.deal.savedFilters via parseSavedFilterDefinition), so this
// module stays zod-free and no longer drags zod into the board bundle.

import type { SavedViewDefinitionAvailability } from "@/features/saved-filters/savedView";
import type { FilterDefinition } from "@/features/saved-filters/schemas";

export type SavedFilterView = {
  id: string;
  name: string;
  favorite: boolean;
  isShared: boolean;
  // True when the session user owns this filter. Only owners can toggle its favorite flag (the
  // flag is a per-row, owner-scoped column), so the UI hides the star for others' shared filters.
  isOwn: boolean;
} & SavedViewDefinitionAvailability<FilterDefinition>;

export type AvailableSavedFilterView = Extract<SavedFilterView, { definition: FilterDefinition }>;

// The complete availability union is retained, including a null definition for invalid rows.
export function rowToView(row: SavedFilterView): SavedFilterView {
  const base = {
    id: row.id,
    name: row.name,
    favorite: row.favorite,
    isShared: row.isShared,
    isOwn: row.isOwn,
  };
  return row.availability === "unavailable"
    ? { ...base, availability: "unavailable", definition: null, problem: row.problem }
    : {
        ...base,
        ...(row.availability === undefined ? {} : { availability: "available" as const }),
        definition: row.definition,
      };
}
