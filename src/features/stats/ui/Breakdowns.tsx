"use client";
import { activityTypeName } from "@/features/activities/activityTypeLabels";
import { useLocale, useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { useFormatters } from "@/lib/useFormatters";
import type { ActivityTypeCount, LostReasonCount } from "@/types/stats";
import { useStatsMessages } from "../useStatsMessages";
import { Bar, money, Panel } from "./Panel";

export function ActivityTypesWidget({ data }: { data: ActivityTypeCount[] }) {
  const locale = useLocale();

  const format = useFormatters();

  const S = useStatsMessages();

  const max = Math.max(1, ...data.map((t) => t.completed));
  return (
    <Panel
      title={S.widgetActivityTypes}
      isEmpty={data.length === 0}
      emptyText={S.emptyActivityTypes}
    >
      <div className="space-y-2">
        {data.map((t) => (
          <div key={t.typeId}>
            <div className="mb-0.5 flex items-center justify-between text-sm">
              <span className="truncate">{activityTypeName(t, locale)}</span>
              <span className="tabular-nums text-muted-foreground">
                {format.number(t.completed)}
              </span>
            </div>
            <Bar label={activityTypeName(t, locale)} pct={(t.completed / max) * 100} />
          </div>
        ))}
      </div>
    </Panel>
  );
}

export function LostReasonsWidget({
  data,
  currency,
}: {
  data: LostReasonCount[];
  currency: string;
}) {
  const preferences = useLocalePreferences();

  const format = useFormatters();

  const S = useStatsMessages();

  // Scaled by money lost, not by deal count: one deal lost for $91,500 and one for $31,000 are
  // the same count and very different news. The count stays beside the label.
  const max = Math.max(1, ...data.map((r) => Number(r.value)));
  return (
    <Panel title={S.widgetLostReasons} isEmpty={data.length === 0} emptyText={S.emptyLostReasons}>
      <div className="space-y-2">
        {data.map((r) => {
          // A null name means the deal was closed lost with nothing recorded, which is worth
          // seeing as its own row rather than hiding.
          const label = r.name ?? S.lostReasonUnspecified;
          return (
            <div key={r.reasonId ?? `text:${r.name ?? "unspecified"}`}>
              <div className="mb-0.5 flex items-center justify-between gap-2 text-sm">
                <span className="flex min-w-0 items-baseline gap-1.5">
                  <span className="truncate">{label}</span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    ({format.number(r.count)})
                  </span>
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {money(r.value, currency, preferences)}
                </span>
              </div>
              <Bar label={label} pct={(Number(r.value) / max) * 100} />
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
