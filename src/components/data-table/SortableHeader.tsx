import type React from "react";
import type { ColumnSort } from "./useColumnSort";

export function SortableHeader<Field extends string>({
  field,
  label,
  sort,
  onSort,
}: {
  field: Field;
  label: string;
  sort: ColumnSort<Field>;
  onSort: (field: Field) => void;
}): React.ReactNode {
  const direction = sort.field === field ? sort.dir : null;
  return (
    <th
      aria-sort={direction === null ? "none" : direction === "asc" ? "ascending" : "descending"}
      className="px-4 py-3 text-start font-medium"
    >
      <button
        type="button"
        onClick={() => onSort(field)}
        className="inline-flex items-center font-semibold hover:text-foreground"
      >
        {label}
        {direction !== null && (
          <span aria-hidden="true" className="ms-1 inline-block text-[10px]">
            {direction === "asc" ? "▲" : "▼"}
          </span>
        )}
      </button>
    </th>
  );
}
