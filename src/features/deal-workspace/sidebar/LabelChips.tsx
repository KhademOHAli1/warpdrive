import type React from "react";

// Resolved label chip: display name + the Tailwind classes that paint its color (from
// useLabelChipResolver). Rendered end-aligned to match the sidebar's value column.
export interface ResolvedLabelChip {
  name: string;
  classes: string;
}

// Renders a person/organization Labels row value: the resolved chips, or "-" when there are none.
// Shared by PersonBlock and OrgBlock so the lead drawer's per-entity Labels rows match Pipedrive.
export function LabelChips({ labels }: { labels: ResolvedLabelChip[] }): React.ReactNode {
  if (labels.length === 0) return "-";
  return (
    <span className="flex flex-wrap justify-end gap-1">
      {labels.map((label) => (
        <span
          key={label.name}
          className={`rounded-full border px-2 py-0.5 text-xs font-medium ${label.classes}`}
        >
          <bdi dir="auto">{label.name}</bdi>
        </span>
      ))}
    </span>
  );
}
