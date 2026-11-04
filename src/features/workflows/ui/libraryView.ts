import type { WorkflowLibraryPage, WorkflowLibraryRow } from "../library";
import type { LibraryLocationInput } from "./libraryLocation";
import type { LibraryAcknowledgement } from "./WorkflowLifecycleDialog";

export type LibraryOverlay = Pick<
  LibraryAcknowledgement,
  "id" | "name" | "revision" | "active" | "archivedAt" | "publishedNumber" | "updatedAt"
>;

export function libraryOverlay(row: LibraryAcknowledgement): LibraryOverlay {
  return {
    id: row.id,
    name: row.name,
    revision: row.revision,
    active: row.active,
    archivedAt: row.archivedAt,
    publishedNumber: row.publishedNumber,
    updatedAt: row.updatedAt,
  };
}

export function libraryVisibleRows(
  data: WorkflowLibraryPage | undefined,
  overlays: Record<string, LibraryOverlay>,
  input: LibraryLocationInput,
  denied: boolean,
  placeholder: boolean,
): WorkflowLibraryRow[] {
  if (denied || placeholder || data === undefined) return [];
  return data.items.flatMap((original): WorkflowLibraryRow[] => {
    const overlay = overlays[original.id];
    if (overlay === undefined || original.revision >= overlay.revision) return [original];
    const archived = overlay.archivedAt !== null;
    if ((input.archive === "archived") !== archived) return [];
    const lifecycle = archived
      ? "archived"
      : overlay.active
        ? "active"
        : overlay.publishedNumber === null
          ? "draft"
          : "paused";
    return [{ ...original, ...overlay, lifecycle }];
  });
}

export function libraryHasFilters(input: LibraryLocationInput): boolean {
  return (
    input.query !== "" ||
    input.archive !== "current" ||
    input.status !== "all" ||
    input.ownerId !== undefined ||
    input.health !== "all" ||
    input.sort !== "updated-desc" ||
    input.limit !== 25 ||
    input.cursor !== undefined
  );
}

type ChipKey =
  | "archived"
  | "active"
  | "draft"
  | "paused"
  | "libraryHealthFailed"
  | "librarySelectedOwner"
  | "librarySortNameAsc"
  | "librarySortNameDesc";

export function libraryFilterChips(
  input: LibraryLocationInput,
  rows: WorkflowLibraryRow[],
  t: (key: ChipKey) => string,
): { id: string; label: string }[] {
  const chips: [string, string | null][] = [
    ["query", input.query === "" ? null : input.query],
    ["archive", input.archive === "archived" ? t("archived") : null],
    ["status", input.status === "all" ? null : t(input.status)],
    ["health", input.health === "all" ? null : t("libraryHealthFailed")],
    [
      "owner",
      input.ownerId === undefined
        ? null
        : (rows.find((row) => row.owner.id === input.ownerId)?.owner.name ??
          t("librarySelectedOwner")),
    ],
    [
      "sort",
      input.sort === "updated-desc"
        ? null
        : t(input.sort === "name-asc" ? "librarySortNameAsc" : "librarySortNameDesc"),
    ],
  ];
  return chips.flatMap(([id, label]) => (label === null ? [] : [{ id, label }]));
}

export function libraryEmptyState(
  data: WorkflowLibraryPage | undefined,
  rows: WorkflowLibraryRow[],
  input: LibraryLocationInput,
  confirmed: boolean,
) {
  if (!confirmed || data === undefined || rows.length !== 0)
    return { continuation: false, scope: false, matches: false };
  return {
    continuation: input.cursor !== undefined,
    scope: input.cursor === undefined && !data.scopeHasItems,
    matches: input.cursor === undefined && data.scopeHasItems,
  };
}
