"use client";
import type React from "react";
import { PILL_TAB, Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";

export type TimelineView = "focus" | "history";

interface TimelineTabsProps {
  view: TimelineView;
  onView: (v: TimelineView) => void;
  children: React.ReactNode;
}

const VIEWS: { key: TimelineView }[] = [{ key: "focus" }, { key: "history" }];

// Focus vs History switch (Pipedrive parity): Focus surfaces what still needs
// action, History is the read-only log. Sits above whatever the caller renders
// for the active view (the History side nests its own per-type filter tabs).
export function TimelineTabs({ view, onView, children }: TimelineTabsProps): React.ReactNode {
  const translateSales = useAppTranslations("sales");

  return (
    <Tabs value={view} onValueChange={(v) => onView(v as TimelineView)}>
      <TabsList aria-label={translateSales("timeline_view_6dee7")} className="mb-3 gap-1">
        {VIEWS.map((v) => (
          <TabsTrigger key={v.key} value={v.key} className={PILL_TAB}>
            {translateSales(v.key === "focus" ? "computed.focus" : "computed.history")}
          </TabsTrigger>
        ))}
      </TabsList>
      {children}
    </Tabs>
  );
}
