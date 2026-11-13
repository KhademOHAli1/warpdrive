"use client";
import type React from "react";
import { SortableHeader } from "@/components/data-table/SortableHeader";
import type { ColumnSort } from "@/components/data-table/useColumnSort";
import { Checkbox } from "@/components/ui/Checkbox";
import type { ActivitySortField } from "./schemas";
import { useActivitiesMessages } from "./useActivitiesMessages";

interface ActivitiesTableHeadProps {
  effective: ColumnSort<ActivitySortField>;
  onSort: (field: ActivitySortField) => void;
  allSelected: boolean;
  onToggleAll: () => void;
}

// The Activities table's <thead>, extracted from ActivitiesTable to keep it under the
// project's file-size budget. Column order and labels are Pipedrive parity (Task 8's
// Duration/Assignee columns, Task 9's sortable Duration).
export function ActivitiesTableHead({
  effective,
  onSort,
  allSelected,
  onToggleAll,
}: ActivitiesTableHeadProps): React.ReactNode {
  const S = useActivitiesMessages();
  const headerClassName = "px-3 py-2 font-semibold";
  const sortProps = {
    sort: effective,
    onSort,
    className: headerClassName,
    inactiveAriaSort: null,
  };
  return (
    <thead className="sticky top-0 bg-muted/60 text-start text-xs uppercase text-muted-foreground">
      <tr>
        <th className="w-8 px-3 py-2">
          <Checkbox label={S.selectAll} checked={allSelected} onCheckedChange={onToggleAll} />
        </th>
        <th className={headerClassName}>{S.done}</th>
        <SortableHeader field="subject" label={S.subject} {...sortProps} />
        <th className={headerClassName}>{S.deal}</th>
        <SortableHeader field="priority" label={S.priority} {...sortProps} />
        <th className={headerClassName}>{S.contact}</th>
        <th className={headerClassName}>{S.email}</th>
        <th className={headerClassName}>{S.phone}</th>
        <th className={headerClassName}>{S.organization}</th>
        <SortableHeader field="dueAtIso" label={S.due} {...sortProps} />
        <SortableHeader field="duration" label={S.durationLabel} {...sortProps} />
        <th className={headerClassName}>{S.assignee}</th>
      </tr>
    </thead>
  );
}
