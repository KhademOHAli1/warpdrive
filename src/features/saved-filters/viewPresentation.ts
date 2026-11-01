import { err, ok, type Result } from "@/types/result";
import { SAVED_VIEW_PRESENTATION_VERSION } from "./viewDefinitionConstants";

export const SAVED_VIEW_PRESENTATION_CATALOG = {
  person: {
    pinnedColumn: "name",
    columns: ["name", "org", "email", "phone", "closedDeals"],
    sortFields: ["name", "primaryEmail"],
  },
  organization: {
    pinnedColumn: "name",
    columns: ["name", "address", "closedDeals", "openDeals", "peopleCount"],
    sortFields: ["name"],
  },
  lead: {
    pinnedColumn: "title",
    columns: ["title", "nextActivity", "labels", "sourceOrigin", "value", "createdAt", "owner"],
    sortFields: [
      "title",
      "nextActivityAt",
      "label",
      "sourceOrigin",
      "value",
      "createdAt",
      "ownerName",
    ],
  },
} as const;

export type SavedViewPresentationTarget = keyof typeof SAVED_VIEW_PRESENTATION_CATALOG;
export type PresentationSortField<T extends SavedViewPresentationTarget> =
  (typeof SAVED_VIEW_PRESENTATION_CATALOG)[T]["sortFields"][number];
export type PresentationColumnKey<T extends SavedViewPresentationTarget> =
  (typeof SAVED_VIEW_PRESENTATION_CATALOG)[T]["columns"][number];
export interface SavedViewPresentationSort {
  field: string;
  dir: "asc" | "desc";
}
export interface SavedViewPresentation {
  version: typeof SAVED_VIEW_PRESENTATION_VERSION;
  columns: string[];
  sort: SavedViewPresentationSort;
}
export interface ReservedSavedViewPresentation {
  version: typeof SAVED_VIEW_PRESENTATION_VERSION;
}

export function isSavedViewPresentationTarget(value: string): value is SavedViewPresentationTarget {
  return Object.hasOwn(SAVED_VIEW_PRESENTATION_CATALOG, value);
}

export function isSavedViewSortField<T extends SavedViewPresentationTarget>(
  targetEntity: T,
  field: string,
): field is PresentationSortField<T> {
  return (SAVED_VIEW_PRESENTATION_CATALOG[targetEntity].sortFields as readonly string[]).includes(
    field,
  );
}

export function isFullSavedViewPresentation(
  presentation: SavedViewPresentation | ReservedSavedViewPresentation | undefined,
): presentation is SavedViewPresentation {
  return presentation !== undefined && "columns" in presentation;
}

// Capture only the builtin presentation the native list can apply. Custom fields need a separate
// metadata and permission resolver; silently dropping an unsupported choice would misstate a view.
export function captureSavedViewPresentation(
  targetEntity: string,
  columns: readonly string[],
  sort: SavedViewPresentationSort,
): Result<SavedViewPresentation, "unsupported-column" | "unsupported-sort"> {
  if (!isSavedViewPresentationTarget(targetEntity)) return err("unsupported-column");
  const catalog = SAVED_VIEW_PRESENTATION_CATALOG[targetEntity];
  if (
    columns[0] !== catalog.pinnedColumn ||
    new Set(columns).size !== columns.length ||
    columns.some((column) => !(catalog.columns as readonly string[]).includes(column))
  ) {
    return err("unsupported-column");
  }
  if (!isSavedViewSortField(targetEntity, sort.field)) return err("unsupported-sort");
  return ok({
    version: SAVED_VIEW_PRESENTATION_VERSION,
    columns: [...columns],
    sort: { field: sort.field, dir: sort.dir },
  });
}

// Client admission also covers transient search/quick filters that the stored contract cannot encode.
export type SavedViewPresentationCapture = Result<
  SavedViewPresentation,
  "unsupported-column" | "unsupported-sort" | "unsupported-scope"
>;
