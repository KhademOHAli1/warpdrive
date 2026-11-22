import type { AssetsWorkspace } from "../contracts";

export const assetRegisterColumns = [
  "name",
  "tracking",
  "location",
  "holder",
  "quantity",
  "serial",
  "model",
  "category",
  "tags",
] as const;

export const assetRegisterSortableColumns = [
  "name",
  "serial",
  "model",
  "category",
  "tracking",
  "location",
  "quantity",
] as const;

export const defaultAssetRegisterColumns: readonly AssetRegisterColumn[] = [
  "name",
  "tracking",
  "location",
  "holder",
  "quantity",
];
export const maxAssetRegisterSortColumns = 3;
export const maxAssetRegisterSelection = 100;
export const maxAssetRegisterViewName = 80;
export const maxAssetRegisterViews = 25;

export type AssetRegisterColumn = (typeof assetRegisterColumns)[number];
export type AssetRegisterSortableColumn = (typeof assetRegisterSortableColumns)[number];
export type AssetRegisterSort = {
  column: AssetRegisterSortableColumn;
  direction: "asc" | "desc";
}[];

export type AssetRegisterFilters = {
  site: string;
  search: string;
  category: string;
  tracking: string;
  status: "active" | "archived";
  location: string;
  includeSublocations: boolean;
};

export type AssetRegisterSettings = {
  filters: AssetRegisterFilters;
  columns: AssetRegisterColumn[];
  sort: AssetRegisterSort;
};

export type AssetRegisterView = {
  id: string;
  name: string;
  settings: AssetRegisterSettings;
  version: number;
};

export type AssetRegisterViewSave = {
  id: string | null;
  version: number | null;
  name: string;
  settings: AssetRegisterSettings;
  requestId: string;
};
export type AssetRegisterViewRemove = { id: string; version: number; requestId: string };
export type AssetRegisterViewsResult =
  | { ok: true; views: AssetRegisterView[] }
  | { ok: false; error: "unavailable" | "invalid" | "conflict" | "limit" };

export type AssetRegisterBatchIntent =
  | { type: "addTags" | "removeTags"; tags: string[] }
  | { type: "setCategory"; categoryId: string | null }
  | { type: "setModel"; modelId: string | null };

export type AssetRegisterBatchInput = {
  siteId: string;
  selection: { assetId: string; version: number }[];
  intent: AssetRegisterBatchIntent;
  requestId: string;
};

export type AssetRegisterBatchOutcome = {
  assetId: string;
  state: "applied" | "skipped" | "conflict" | "unavailable";
  reason: "changed" | "unchanged" | "incompatible" | "protected" | "stale" | "unavailable";
};

export type AssetRegisterBatchResult =
  | { ok: true; workspace: AssetsWorkspace; outcomes: AssetRegisterBatchOutcome[] }
  | { ok: false; error: "unavailable" | "invalid" | "conflict" };

export type AssetRegisterDiscoveryAccess = {
  readViews: () => Promise<AssetRegisterViewsResult>;
  saveView: (input: AssetRegisterViewSave) => Promise<AssetRegisterViewsResult>;
  removeView: (input: AssetRegisterViewRemove) => Promise<AssetRegisterViewsResult>;
  batch: (input: AssetRegisterBatchInput) => Promise<AssetRegisterBatchResult>;
};
