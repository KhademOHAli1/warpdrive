"use client";
import type React from "react";
import { activityTypeName } from "@/features/activities/activityTypeLabels";
import { CollapsibleSection } from "@/features/deal-workspace/CollapsibleSection";
import { FieldRow } from "@/features/deal-workspace/sidebar/FieldRow";
import { useAppTranslations, useLocale } from "@/features/i18n/LocaleProvider";
import { trpc } from "@/lib/trpc-client";
import { useFormatters } from "@/lib/useFormatters";

function capitalize(key: string): string {
  return key.length === 0 ? key : key[0]?.toUpperCase() + key.slice(1);
}

// Person/org detail "Overview" section (CO-2), modeled on the deal sidebar's Overview + the org
// Stats block: a compact activity summary (total + per-type counts + last-activity / inactive-days)
// sourced from contacts.activityStats. Read-only; the per-type rows collapse the counts-by-type the
// procedure computes into one row each.
export function ContactOverviewSection({
  entityType,
  entityId,
}: {
  entityType: "person" | "organization";
  entityId: string;
}): React.ReactNode {
  const tContacts = useAppTranslations("contacts");

  const format = useFormatters();
  const locale = useLocale();
  const types = trpc.activities.listTypes.useQuery().data ?? [];
  const typeByKey = new Map(types.map((type) => [type.key, type]));
  const stats = trpc.contacts.activityStats.useQuery({ entityType, entityId }).data;
  const total = stats?.total ?? 0;
  const byType = stats?.byType ?? {};
  const mostActiveUsers = stats?.mostActiveUsers ?? [];
  const lastActivityAt = stats?.lastActivityAt ?? null;
  const inactiveDays = stats?.inactiveDays ?? null;

  return (
    <CollapsibleSection title={tContacts("overview")}>
      <FieldRow label={tContacts("totalActivities")}>
        <span className="tabular-nums">{format.number(total)}</span>
      </FieldRow>
      {Object.entries(byType).map(([key, count]) => (
        <FieldRow
          key={key}
          label={
            typeByKey.has(key) ? activityTypeName(typeByKey.get(key)!, locale) : capitalize(key)
          }
        >
          <span className="tabular-nums">{format.number(count)}</span>
        </FieldRow>
      ))}
      <FieldRow label={tContacts("mostActiveUsers")} empty={mostActiveUsers.length === 0}>
        {mostActiveUsers.length > 0
          ? mostActiveUsers.map((u) => (
              <bdi key={u.name} dir="auto" className="me-2 inline-block">
                {u.name} ({format.number(u.count)})
              </bdi>
            ))
          : "-"}
      </FieldRow>
      <FieldRow label={tContacts("lastActivity")} empty={lastActivityAt === null}>
        {lastActivityAt !== null ? (
          <span className="tabular-nums">
            {format.dateTime(lastActivityAt, { dateStyle: "medium" })}
          </span>
        ) : (
          "-"
        )}
      </FieldRow>
      <FieldRow label={tContacts("inactive")} empty={inactiveDays === null}>
        {inactiveDays !== null ? (
          <span>
            <span className="tabular-nums">
              {tContacts("inactiveDays", { count: inactiveDays })}
            </span>
          </span>
        ) : (
          "-"
        )}
      </FieldRow>
    </CollapsibleSection>
  );
}
