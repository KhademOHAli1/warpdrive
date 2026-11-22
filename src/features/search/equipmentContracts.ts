import type { SearchResult } from "@/types/search";

export type EquipmentSearchResult = Pick<SearchResult, "id" | "primary" | "secondary"> & {
  kind: "asset" | "kit";
};
