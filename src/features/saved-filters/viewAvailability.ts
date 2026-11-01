import type { SavedView } from "./savedView";

// No lookup is performed for a missing selection, so recovery cannot disclose a hidden view.
export function missingSavedView(
  id: string,
  name = "",
): Extract<SavedView, { availability: "unavailable" }> {
  return {
    id,
    name,
    favorite: false,
    isShared: false,
    isOwn: false,
    availability: "unavailable",
    definition: null,
    problem: { kind: "missing", code: "missing-or-no-longer-visible" },
  };
}
