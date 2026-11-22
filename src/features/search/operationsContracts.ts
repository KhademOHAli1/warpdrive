import type { SearchResult } from "@/types/search";

export const operationsSearchResultsPerKind = 6;
export type OperationsSearchKind = "location" | "booking";
export type OperationsSearchResult = Pick<SearchResult, "id" | "primary" | "secondary"> & {
  kind: OperationsSearchKind;
};
export type OperationsSearchFixtureEntry = OperationsSearchResult;
