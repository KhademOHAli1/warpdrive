import type React from "react";
import type { ColumnSort } from "./useColumnSort";

export function SortableHeader<Field extends string>({
  field,
  label,
  sort,
  onSort,
  className = "px-4 py-3 text-start font-medium",
  buttonClassName = "inline-flex items-center font-semibold hover:text-foreground",
  inactiveAriaSort = "none",
  afterButton,
}: {
  field: Field;
  label: string;
  sort: ColumnSort<Field>;
  onSort: (field: Field) => void;
  className?: string;
  buttonClassName?: string;
  inactiveAriaSort?: "none" | null;
  afterButton?: React.ReactNode;
}): React.ReactNode {
  const direction = sort.field === field ? sort.dir : null;
  return (
    <th
      scope="col"
      aria-sort={
        direction === null
          ? (inactiveAriaSort ?? undefined)
          : direction === "asc"
            ? "ascending"
            : "descending"
      }
      className={className}
    >
      <button type="button" onClick={() => onSort(field)} className={buttonClassName}>
        {label}
        {direction !== null && (
          <span aria-hidden="true" className="ms-1 inline-block text-[10px]">
            {direction === "asc" ? "▲" : "▼"}
          </span>
        )}
      </button>
      {afterButton}
    </th>
  );
}
