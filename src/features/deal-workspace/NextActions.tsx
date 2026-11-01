"use client";

import type { ComponentProps } from "react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { useFormatters } from "@/lib/useFormatters";
import { HistoryFeed } from "./HistoryFeed";
import { SectionHeading } from "./SectionHeading";

export type WorkspaceReadState = "pending" | "error" | "success";
const PREVIEW_COUNT = 3;

// A working queue has a different order from an audit trail: overdue first, then earliest due.
// Copy the bucket so the read-only history keeps its chronological order.
export function NextActions({
  readState = "success",
  onRetry,
  onSchedule,
  ...feed
}: ComponentProps<typeof HistoryFeed> & {
  readState?: WorkspaceReadState;
  onRetry?: () => void;
  onSchedule?: () => void;
}) {
  const t = useAppTranslations("dealWorkspace");
  const format = useFormatters();
  const [expanded, setExpanded] = useState(false);
  const items = [...feed.items].sort((a, b) => {
    const urgentA = a.kind === "activity" && a.activity.overdue;
    const urgentB = b.kind === "activity" && b.activity.overdue;
    return (
      Number(urgentB) - Number(urgentA) ||
      a.at.getTime() - b.at.getTime() ||
      a.id.localeCompare(b.id)
    );
  });
  const hasData = items.length > 0;

  return (
    <section aria-label={t("nextActions")} className="rounded-lg border bg-card p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <SectionHeading>{t("nextActions")}</SectionHeading>
        <div className="flex flex-wrap items-center gap-3">
          {hasData && (
            <span className="text-xs tabular-nums text-muted-foreground">
              {t("openCount", { count: format.number(items.length) })}
            </span>
          )}
          {onSchedule && (
            <Button size="sm" onClick={onSchedule}>
              {t("scheduleActivity")}
            </Button>
          )}
        </div>
      </div>
      {readState === "pending" && !hasData && (
        <p role="status" className="text-sm text-muted-foreground">
          {t("loadingActivities")}
        </p>
      )}
      {readState === "error" && (
        <div
          role="alert"
          className="mb-3 flex items-center justify-between gap-3 text-sm text-destructive"
        >
          <p>{t("activitiesFailed")}</p>
          <Button variant="outline" size="sm" onClick={onRetry}>
            {t("retry")}
          </Button>
        </div>
      )}
      {(hasData || readState === "success") && (
        <HistoryFeed
          {...feed}
          compact
          emptyLabel={onSchedule ? t("noNextAction") : feed.emptyLabel}
          items={expanded ? items : items.slice(0, PREVIEW_COUNT)}
        />
      )}
      {items.length > PREVIEW_COUNT && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-3"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? t("showLess") : t("viewAll", { count: format.number(items.length) })}
        </Button>
      )}
    </section>
  );
}
