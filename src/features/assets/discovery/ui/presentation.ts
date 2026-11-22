import type { ColumnDef } from "@/components/data-table/columnModel";
import type { AssetWords } from "../../ui/assetMessages";
import {
  type AssetRegisterColumn,
  type AssetRegisterSort,
  type AssetRegisterSortableColumn,
  assetRegisterColumns,
  defaultAssetRegisterColumns,
  maxAssetRegisterSortColumns,
} from "../contracts";

type AssetColumn = ColumnDef & { key: AssetRegisterColumn };

export function registerColumnCatalog(
  words: AssetWords,
  holder: string,
  hasHolder: boolean,
): AssetColumn[] {
  return assetRegisterColumns
    .filter((key) => key !== "holder" || hasHolder)
    .map((key) => ({
      key,
      header: key === "holder" ? holder : words[key],
      pinned: key === "name",
      defaultVisible: defaultAssetRegisterColumns.includes(key),
    }));
}

export function cycleAssetRegisterSort(
  sort: AssetRegisterSort,
  column: AssetRegisterSortableColumn,
): AssetRegisterSort {
  const [first] = sort;
  const other = sort.filter((criterion) => criterion.column !== column);
  if (first?.column === column && first.direction === "desc") return other;
  const direction = first?.column === column ? "desc" : "asc";
  return [{ column, direction }, ...other.slice(0, maxAssetRegisterSortColumns - 1)];
}
