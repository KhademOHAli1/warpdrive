"use client";
import type React from "react";
import { Fragment } from "react";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import type { ActivityTableRow } from "./activityRows";
import { activityDay } from "./activityTemporal";
import { isoToDayHeading, isoToDayLabel } from "./dayHeading";
import { useActivitiesMessages } from "./useActivitiesMessages";

const NO_DATE_HEADING = "No date";

interface Props {
  rows: ActivityTableRow[];
  renderRow: (row: ActivityTableRow) => React.ReactNode;
  columnCount: number;
}

// Groups list rows under day-header rows (Pipedrive list parity). Undated rows fall under a
// trailing "No date" group. Order within a group mirrors the incoming row order (the table's
// own sort already governs that); a group's position is set by the first row that lands in it.
//
// Renders flat <tr> siblings (one header row per group, then that group's rows) rather than
// nesting a <section>/<h3> wrapper: the table content model only allows <tr> as a direct child
// of <tbody>, so anything else placed there breaks the table's rendering.
export function ActivityDayGroups({ rows, renderRow, columnCount }: Props): React.ReactNode {
  const S = useActivitiesMessages();
  const preferences = useLocalePreferences();
  const groups = new Map<string, ActivityTableRow[]>();
  for (const r of rows) {
    const key = activityDay(r, preferences.timeZone) ?? NO_DATE_HEADING;
    const bucket = groups.get(key) ?? [];
    bucket.push(r);
    groups.set(key, bucket);
  }

  return (
    <>
      {Array.from(groups.entries()).map(([heading, bucket]) => (
        <Fragment key={heading}>
          <tr>
            <td
              colSpan={columnCount}
              className="bg-muted/40 px-3 py-1 text-xs font-medium text-muted-foreground"
            >
              <h3
                aria-label={
                  heading === NO_DATE_HEADING ? S.noDate : isoToDayLabel(heading, preferences)
                }
              >
                {heading === NO_DATE_HEADING ? S.noDate : isoToDayHeading(heading, preferences)}
              </h3>
            </td>
          </tr>
          {bucket.map(renderRow)}
        </Fragment>
      ))}
    </>
  );
}
