import type { AssetRecord, AssetsWorkspace } from "../contracts";
import type { AssetRegisterSort, AssetRegisterSortableColumn } from "./contracts";

type SortValue = string | number | null;

function compareValue(
  a: SortValue,
  b: SortValue,
  direction: "asc" | "desc",
  collator: Intl.Collator,
) {
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  const comparison =
    typeof a === "number" && typeof b === "number" ? a - b : collator.compare(String(a), String(b));
  return direction === "asc" ? comparison : -comparison;
}

export function sortAssetRegisterRecords(
  records: readonly AssetRecord[],
  workspace: AssetsWorkspace,
  locationLabels: ReadonlyMap<string, string>,
  sort: AssetRegisterSort,
  locale: string,
): AssetRecord[] {
  if (sort.length === 0) return [...records];
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
  const categories = new Map(workspace.categories.map(({ id, name }) => [id, name]));
  const models = new Map(workspace.models.map(({ id, name }) => [id, name]));

  function location(record: AssetRecord) {
    if (record.tracking === "individual")
      return record.locationId === null ? null : (locationLabels.get(record.locationId) ?? null);
    const names = record.balances.flatMap(({ locationId, quantity }) => {
      const label = locationLabels.get(locationId);
      return quantity > 0 && label !== undefined ? [label] : [];
    });
    return names.length === 0 ? null : names.sort(collator.compare).join(" · ");
  }

  function field(record: AssetRecord, column: AssetRegisterSortableColumn): SortValue {
    switch (column) {
      case "name":
        return record.name;
      case "serial":
        return record.tracking === "individual" ? record.serial : null;
      case "tracking":
        return record.tracking;
      case "model":
        return record.tracking === "individual" && record.modelId !== null
          ? (models.get(record.modelId) ?? null)
          : null;
      case "category":
        return record.categoryId === null ? null : (categories.get(record.categoryId) ?? null);
      case "location":
        return location(record);
      case "quantity":
        return record.tracking === "individual"
          ? 1
          : record.balances.reduce((total, balance) => total + balance.quantity, 0);
    }
  }

  const ranked = records.map((record) => ({
    record,
    values: sort.map(({ column }) => field(record, column)),
  }));
  ranked.sort((left, right) => {
    for (const [index, criterion] of sort.entries()) {
      const comparison = compareValue(
        left.values[index] ?? null,
        right.values[index] ?? null,
        criterion.direction,
        collator,
      );
      if (comparison !== 0) return comparison;
    }
    return left.record.id.localeCompare(right.record.id);
  });
  return ranked.map(({ record }) => record);
}
