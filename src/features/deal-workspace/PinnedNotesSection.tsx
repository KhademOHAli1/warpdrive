"use client";
import type React from "react";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { HistoryFeed } from "./HistoryFeed";
import type { HistoryItem } from "./historyTimeline";
import { SectionHeading } from "./SectionHeading";

// One pinned-note surface for deal, lead, person, and organization timelines. The partitioner
// guarantees this bucket contains only pinned notes and excludes them from History.
export function PinnedNotesSection({
  items,
  onNoteChanged,
}: {
  items: HistoryItem[];
  onNoteChanged?: () => void;
}): React.ReactNode {
  const translateSales = useAppTranslations("sales");

  if (items.length === 0) return null;

  return (
    <section aria-label={translateSales("pinned_3fab5")}>
      <SectionHeading>{translateSales("pinned_f20c8")}</SectionHeading>
      <HistoryFeed items={items} emptyLabel="" onNoteChanged={onNoteChanged} />
    </section>
  );
}
