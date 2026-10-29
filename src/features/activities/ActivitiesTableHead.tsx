"use client";
import type React from "react";
import type { ColumnSort } from "@/components/data-table/useColumnSort";
import { Checkbox } from "@/components/ui/Checkbox";
import { ActivitySortableTh } from "./ActivitySortableHeader";
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
  return (
    <thead className="sticky top-0 bg-muted/60 text-start text-xs uppercase text-muted-foreground">
      <tr>
        <th className="w-8 px-3 py-2">
          <Checkbox label={S.selectAll} checked={allSelected} onCheckedChange={onToggleAll} />
        </th>
        <th className="px-3 py-2 font-semibold">{S.done}</th>
        <ActivitySortableTh field="subject" label={S.subject} sort={effective} onSort={onSort} />
        <th className="px-3 py-2 font-semibold">{S.deal}</th>
        <ActivitySortableTh field="priority" label={S.priority} sort={effective} onSort={onSort} />
        <th className="px-3 py-2 font-semibold">{S.contact}</th>
        <th className="px-3 py-2 font-semibold">{S.email}</th>
        <th className="px-3 py-2 font-semibold">{S.phone}</th>
        <th className="px-3 py-2 font-semibold">{S.organization}</th>
        <ActivitySortableTh field="dueAtIso" label={S.due} sort={effective} onSort={onSort} />
        <ActivitySortableTh
          field="duration"
          label={S.durationLabel}
          sort={effective}
          onSort={onSort}
        />
        <th className="px-3 py-2 font-semibold">{S.assignee}</th>
      </tr>
    </thead>
  );
}
