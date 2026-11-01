import type { SavedView } from "./savedView";
import type { SavedViewSelectionRead } from "./savedViewSelectionSchema";
import { missingSavedView } from "./viewAvailability";

export interface SavedViewSelectionSeed {
  initialSavedView: SavedView | null;
  initialSelectionBlocked: boolean;
}

// The supplied list must already be scoped to this entity and the current own/shared visibility.
// Never look up an inaccessible ID separately, since that would reveal hidden view metadata.
export function resolveSavedViewSelection(
  selection: SavedViewSelectionRead | undefined,
  visibleViews: readonly SavedView[],
): SavedViewSelectionSeed {
  if (selection !== undefined && "status" in selection) {
    return { initialSavedView: null, initialSelectionBlocked: true };
  }
  const id = selection?.savedViewId ?? null;
  return {
    initialSavedView:
      id === null ? null : (visibleViews.find((view) => view.id === id) ?? missingSavedView(id)),
    initialSelectionBlocked: false,
  };
}
