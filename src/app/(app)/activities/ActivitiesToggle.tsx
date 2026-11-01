"use client";
import Link from "next/link";
import type React from "react";
import { useActivitiesMessages } from "@/features/activities/useActivitiesMessages";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { cn } from "@/lib/utils";

// List | Calendar view toggle for Activities, mirroring the deal list's toggle.
// Pipedrive's Activities is list-first with a calendar alternative.
export function ActivitiesToggle({
  active,
  queueEnabled = false,
  className,
}: {
  active: "list" | "calendar" | "queue";
  queueEnabled?: boolean;
  className?: string;
}): React.ReactNode {
  const S = useActivitiesMessages();
  const t = useAppTranslations("nextActionQueue");
  const segment = "rounded-sm px-2.5 py-1 text-sm transition-colors";
  const on = "bg-accent text-accent-foreground font-medium";
  const off = "text-muted-foreground hover:text-foreground";
  return (
    <div className={cn("mb-3 inline-flex rounded-md border bg-card p-0.5", className)}>
      {active === "list" ? (
        <span className={cn(segment, on)} aria-current="page">
          {S.list}
        </span>
      ) : (
        <Link href="/activities/list" className={cn(segment, off)}>
          {S.list}
        </Link>
      )}
      {active === "calendar" ? (
        <span className={cn(segment, on)} aria-current="page">
          {S.calendar}
        </span>
      ) : (
        <Link href="/activities/calendar" className={cn(segment, off)}>
          {S.calendar}
        </Link>
      )}
      {queueEnabled &&
        (active === "queue" ? (
          <span className={cn(segment, on)} aria-current="page">
            {t("title")}
          </span>
        ) : (
          <Link href="/activities/queue" className={cn(segment, off)}>
            {t("title")}
          </Link>
        ))}
    </div>
  );
}
