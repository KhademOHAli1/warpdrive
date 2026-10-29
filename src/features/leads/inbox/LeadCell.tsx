"use client";
import { TriangleAlert } from "lucide-react";
import type React from "react";
import { CustomFieldCell } from "@/components/data-table/CustomFieldCell";
import {
  useAppTranslations,
  useLocale,
  useLocalePreferences,
} from "@/features/i18n/LocaleProvider";
import { OwnerBadge } from "@/features/identity/OwnerBadge";
import type { ResolvedLabel } from "@/features/labels/resolveLabels";
import { useLabelChipResolver } from "@/features/labels/useLabelChipResolver";
import { sourceOriginLabel } from "@/features/leads/sourceLabels";
import { useFormatters } from "@/lib/useFormatters";
import type { LeadRow } from "../leadRepo";
import type { LeadColumn } from "./columns";
import { nextActivityState } from "./nextActivityState";

const DATE_OPTIONS = { month: "short", day: "numeric", year: "numeric" } as const;

function NextActivity({
  at,
  now,
}: {
  at: Date | string | null;
  now: Date | null;
}): React.ReactNode {
  const tLeads = useAppTranslations("leads");
  const { timeZone } = useLocalePreferences();

  const format = useFormatters();
  if (at === null) {
    return (
      <span className="flex items-center gap-1 text-warning">
        <TriangleAlert aria-hidden="true" className="h-3.5 w-3.5" />
        {tLeads("noActivity")}
      </span>
    );
  }
  // Pre-mount `now` is null (server + first client render): render the date with no time-based
  // color so SSR and hydration agree. The overdue/today color appears once the clock is set.
  if (now === null) {
    return <span>{format.dateTime(at, DATE_OPTIONS)}</span>;
  }
  const state = nextActivityState(at, now, timeZone);
  return (
    <span className={state === "overdue" ? "text-destructive" : ""}>
      {format.dateTime(at, DATE_OPTIONS)}
    </span>
  );
}

function Labels({ chips }: { chips: ResolvedLabel[] }): React.ReactNode {
  return (
    <div className="flex flex-wrap gap-1">
      {chips.map((chip) => (
        <span
          key={chip.name}
          className={`rounded-full border px-2 py-0.5 text-xs font-medium ${chip.classes}`}
        >
          {chip.name}
        </span>
      ))}
    </div>
  );
}

export function LeadCell({
  column,
  row,
  now,
  currency,
}: {
  column: LeadColumn;
  row: LeadRow;
  now: Date | null;
  currency: string;
}): React.ReactNode {
  const locale = useLocale();
  const resolveLabels = useLabelChipResolver("lead");
  const format = useFormatters();
  if (column.customField) {
    return (
      <CustomFieldCell
        def={column.customField}
        value={row.customFields[column.customField.key]}
        currency={currency}
      />
    );
  }
  switch (column.key) {
    case "title":
      return (
        <span className="font-medium text-foreground">
          <bdi dir="auto">{row.title}</bdi>
        </span>
      );
    case "nextActivity":
      return <NextActivity at={row.nextActivityAt} now={now} />;
    case "labels":
      return <Labels chips={resolveLabels(row.labels)} />;
    case "sourceOrigin":
      return (
        <span className="text-muted-foreground">{sourceOriginLabel(row.sourceOrigin, locale)}</span>
      );
    case "value":
      return (
        <span className="tabular-nums text-muted-foreground">
          {row.value !== null
            ? `${format.currency(row.value, row.currency ?? currency)} ${row.currency ?? currency}`
            : "-"}
        </span>
      );
    case "createdAt":
      return (
        <span className="text-muted-foreground">
          {format.dateTime(row.createdAt, DATE_OPTIONS)}
        </span>
      );
    case "owner":
      return <OwnerBadge name={row.ownerName} />;
    default:
      return null;
  }
}
