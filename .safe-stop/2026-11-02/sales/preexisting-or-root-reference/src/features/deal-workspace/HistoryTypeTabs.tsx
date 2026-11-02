"use client";
import type React from "react";
import { PILL_TAB, Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HistoryFeed } from "@/features/deal-workspace/HistoryFeed";
import type { HistoryItem } from "@/features/deal-workspace/historyTimeline";
import type { DraftSummary } from "@/features/email/draftRepo";
import type { EmailCardScope } from "@/features/email/EmailTimelineCard";
import { FileAttachments } from "@/features/files/FileAttachments";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";

export type HistoryTab = "all" | "activities" | "notes" | "email" | "files" | "changelog";

const TABS: HistoryTab[] = ["all", "activities", "notes", "email", "files", "changelog"];

interface HistoryTypeTabsProps {
  tab: HistoryTab;
  hideEmptyState?: boolean;
  onTab: (t: HistoryTab) => void;
  counts: Partial<Record<HistoryTab, number>>;
  items: Record<HistoryTab, HistoryItem[]>;
  dealId: string;
  onActivityChanged?: () => void;
  // Forwarded to the nested HistoryFeed; not yet wired to a note-level control (Task 6).
  onNoteChanged?: () => void;
  // Open an activity in the inline edit composer.
  onEditActivity?: (activityId: string) => void;
  // Which record's timeline this is, for the email cards' unlink and reply.
  emailScope?: EmailCardScope;
  // Overrides the Email tab's empty line while the linked-message read is loading or failed, so a
  // pending or broken read never reads as "no emails linked".
  emailEmptyLabel?: string;
  // Refetch the record's linked messages after an unlink or a sent reply.
  onEmailChanged?: () => void;
  // Open one of the record's unsent drafts in the host's composer.
  onResumeDraft?: (draft: DraftSummary) => void;
  // Refetch the record's drafts after one is discarded.
  onDraftChanged?: () => void;
}

// The per-type filter row that used to be the entire "History" tab bar (Wave
// 3, Task 17: now nested under the History side of the Focus/History switch,
// filtering the History bucket instead of the raw activities/notes/changelog).
export function HistoryTypeTabs({
  tab,
  hideEmptyState = false,
  onTab,
  counts,
  items,
  dealId,
  onActivityChanged,
  onNoteChanged,
  onEditActivity,
  emailScope,
  emailEmptyLabel,
  onEmailChanged,
  onResumeDraft,
  onDraftChanged,
}: HistoryTypeTabsProps): React.ReactNode {
  const translateSales = useAppTranslations("sales");

  const labels = {
    all: translateSales("computed.allHistory"),
    activities: translateSales("computed.activities"),
    notes: translateSales("computed.notes"),
    email: translateSales("computed.email"),
    files: translateSales("computed.files"),
    changelog: translateSales("computed.changelog"),
  };
  const emptyLabels: Partial<Record<HistoryTab, string>> = {
    all: translateSales("no_history_yet_15f6e"),
    activities: translateSales("computed.noActivities"),
    notes: translateSales("computed.noNotes"),
    changelog: translateSales("computed.noChanges"),
    email: translateSales("computed.noLinkedEmails"),
  };
  return (
    <Tabs value={tab} onValueChange={(v) => onTab(v as HistoryTab)}>
      <TabsList className="flex-wrap gap-1">
        {TABS.map((t) => (
          <TabsTrigger key={t} value={t} className={PILL_TAB}>
            {(counts[t] ?? 0) > 0
              ? translateSales("computed.historyTabCount", {
                  label: labels[t],
                  count: counts[t] ?? 0,
                })
              : labels[t]}
          </TabsTrigger>
        ))}
      </TabsList>

      <div className="pt-4">
        {/* History is a view of what is attached, not a compose surface: read-only so the
            deal page shows one uploader (the compose bar's Files tab), not two. */}
        {tab === "files" && <FileAttachments entityType="deal" entityId={dealId} readOnly />}
        {tab !== "files" && !(hideEmptyState && items[tab].length === 0) && (
          <HistoryFeed
            items={items[tab]}
            emptyLabel={
              (tab === "email" ? emailEmptyLabel : undefined) ??
              emptyLabels[tab] ??
              translateSales("no_history_yet_15f6e")
            }
            onActivityChanged={onActivityChanged}
            onNoteChanged={onNoteChanged}
            onEditActivity={onEditActivity}
            emailScope={emailScope}
            onEmailChanged={onEmailChanged}
            onResumeDraft={onResumeDraft}
            onDraftChanged={onDraftChanged}
          />
        )}
      </div>
    </Tabs>
  );
}
