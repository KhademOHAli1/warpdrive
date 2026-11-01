"use client";
import { useCallback, useMemo } from "react";
import { Button } from "@/components/ui/Button";
import type { Deal } from "@/db/schema";
import type { CalendarActivity } from "@/features/activities/calendar";
import type { HistoryTab } from "@/features/deal-workspace/HistoryTypeTabs";
import { HistoryTypeTabs } from "@/features/deal-workspace/HistoryTypeTabs";
import { resolveCustomFieldOptions } from "@/features/deal-workspace/history/customFieldOptions";
import { resolveStageChangeNames } from "@/features/deal-workspace/history/stageNames";
import { countHistoryTabs } from "@/features/deal-workspace/historyTabCounts";
import type { HistoryItem } from "@/features/deal-workspace/historyTimeline";
import {
  buildHistoryTimeline,
  mergeDraftItems,
  mergeEmailItems,
  partitionFocusHistory,
} from "@/features/deal-workspace/historyTimeline";
import { NextActions, type WorkspaceReadState } from "@/features/deal-workspace/NextActions";
import { PinnedNotesSection } from "@/features/deal-workspace/PinnedNotesSection";
import { SectionHeading } from "@/features/deal-workspace/SectionHeading";
import type { DraftSummary } from "@/features/email/draftRepo";
import { emailTabStatusLabel } from "@/features/email/emailTabStatus";
import { useEmailMessages } from "@/features/email/useEmailMessages";
import { useAppTranslations, useLocale, useNumberingSystem } from "@/features/i18n/LocaleProvider";
import { trpc } from "@/lib/trpc-client";
import type { CustomFieldDef } from "@/types/customFields";

// Stable empty array: a new [] on every render would churn useMemo dependencies below.
const EMPTY: never[] = [];

type Tab = HistoryTab;

interface WorkspaceTabsProps {
  deal: Deal;
  tab: Tab;
  onTab: (t: Tab) => void;
  activities: CalendarActivity[];
  activityReadState?: WorkspaceReadState;
  onRetryActivities?: () => void;
  onScheduleActivity?: () => void;
  // Pipeline stages (id + name) used to resolve stageId changelog rows to names.
  stages: { id: string; name: string }[];
  customFieldDefs?: CustomFieldDef[];
  // Display name of the creating actor for the synthesized "Deal created" anchor.
  createdActorName: string | null;
  // Invalidate the activities query after an in-feed mutation (mark-as-done).
  onActivityChanged?: () => void;
  // Invalidate the notes query after an in-feed note mutation (pin/edit/delete, Task 6).
  onNoteChanged?: () => void;
  // Open an activity in the inline edit composer (threaded to the Focus + History feeds).
  onEditActivity?: (activityId: string) => void;
  // Open one of the deal's unsent drafts in the compose bar, which the workspace owns.
  onResumeDraft?: (draft: DraftSummary) => void;
}

// Buckets the History side's items by the per-type filter row. "created" never appears under a
// type filter other than "all". Files aren't timeline items, so that tab renders its own feature
// component instead of HistoryFeed.
export function bucketByType(history: HistoryItem[]): Record<Tab, HistoryItem[]> {
  return {
    all: history,
    activities: history.filter((i) => i.kind === "activity"),
    notes: history.filter((i) => i.kind === "note"),
    changelog: history.filter((i) => i.kind === "event"),
    // Drafts sit under Email with the sent messages: same conversation, one still unsent.
    email: history.filter((i) => i.kind === "email" || i.kind === "emailDraft"),
    files: [],
  };
}

export function WorkspaceTabs({
  deal,
  tab,
  onTab,
  activities,
  activityReadState = "success",
  onRetryActivities,
  onScheduleActivity,
  stages,
  customFieldDefs = EMPTY,
  createdActorName,
  onActivityChanged,
  onNoteChanged,
  onEditActivity,
  onResumeDraft,
}: WorkspaceTabsProps) {
  const translateSales = useAppTranslations("sales");
  const t = useAppTranslations("dealWorkspace");
  const emailMessages = useEmailMessages();
  const locale = useLocale();
  const numberingSystem = useNumberingSystem();

  // `?? EMPTY` rather than `?? []`: a fresh array literal each render changes the identity of every
  // downstream useMemo dependency, so the timeline was rebuilt on every render while data was absent.
  const notesQuery = trpc.collaboration.listNotes.useQuery({
    entityType: "deal",
    entityId: deal.id,
  });
  const changesQuery = trpc.collaboration.listChangeLog.useQuery({
    entityType: "deal",
    entityId: deal.id,
  });
  const notes = notesQuery.data ?? EMPTY;
  const changelog = changesQuery.data ?? EMPTY;

  // Resolve stageId changelog rows (id values) to stage names before the model
  // builds the timeline, so the stage event row shows names, never raw ids.
  const resolvedChangelog = useMemo(() => {
    const stageNameById = new Map(stages.map((s) => [s.id, s.name]));
    return resolveCustomFieldOptions(
      resolveStageChangeNames(changelog, stageNameById),
      customFieldDefs,
    );
  }, [changelog, stages, customFieldDefs]);

  // Lazy "Deal created" anchor (decision 1): synthesized, not a persisted row, so
  // it appears in the interleaved "All" feed but not the raw Changelog audit trail.
  const createdAt = deal.createdAt;
  const createdAnchor = useMemo(
    () => ({ createdAt, actorName: createdActorName }),
    [createdAt, createdActorName],
  );

  // Linked email reads as timeline items rather than an embedded mailbox reader.
  const emailQuery = trpc.email.listMessagesForDeal.useQuery({ dealId: deal.id });
  const emails = emailQuery.data ?? EMPTY;
  // The actor's own unsent drafts for this deal, shown beside the sent messages.
  const draftQuery = trpc.email.drafts.listForDeal.useQuery({ dealId: deal.id });
  const drafts = draftQuery.data ?? EMPTY;
  const utils = trpc.useUtils();

  // Focus vs History split (Wave 3, Task 17): Focus is the open/actionable
  // activities; History is everything else, filtered by the existing per-type tabs.
  const allItems = useMemo(
    () =>
      mergeDraftItems(
        mergeEmailItems(
          buildHistoryTimeline(
            activities,
            resolvedChangelog,
            notes,
            createdAnchor,
            locale,
            numberingSystem,
          ),
          emails,
        ),
        drafts,
      ),
    [activities, resolvedChangelog, notes, createdAnchor, emails, drafts, locale, numberingSystem],
  );
  const { pinned, focus, history } = useMemo(() => partitionFocusHistory(allItems), [allItems]);
  const historyByType = useMemo(() => bucketByType(history), [history]);

  const emailScope = useMemo(
    () => ({ kind: "deal" as const, dealId: deal.id, personId: deal.personId ?? undefined }),
    [deal.id, deal.personId],
  );
  const onEmailChanged = useCallback(() => {
    void utils.email.listMessagesForDeal.invalidate({ dealId: deal.id });
  }, [utils, deal.id]);
  const onDraftChanged = useCallback(() => {
    void utils.email.drafts.listForDeal.invalidate({ dealId: deal.id });
  }, [utils, deal.id]);

  // Every badge counts off the History bucket (what the tab's list actually shows), not the raw
  // totals: open activities live in Focus and pinned notes live above Focus, so counting
  // activities.length / notes.length would overstate the tab lists below.
  const fileCount = trpc.files.listForEntity.useQuery({ entityType: "deal", entityId: deal.id })
    .data?.length;
  const counts: Partial<Record<Tab, number>> = countHistoryTabs(historyByType, fileCount);

  return (
    <div className="space-y-6">
      <PinnedNotesSection items={pinned} onNoteChanged={onNoteChanged} />

      {/* A failed email read must not read as "this deal has no email", so say so explicitly
          while the rest of the timeline still renders. */}
      {emailQuery.isError === true && (
        <p role="alert" className="text-sm text-destructive">
          {translateSales("couldn_t_load_emails_for_this_deal_please_try_again_b563b")}
        </p>
      )}

      <NextActions
        readState={activityReadState}
        onRetry={onRetryActivities}
        onSchedule={onScheduleActivity}
        items={focus}
        emptyLabel={translateSales("nothing_needs_your_attention_8fa19")}
        onActivityChanged={onActivityChanged}
        onNoteChanged={onNoteChanged}
        onEditActivity={onEditActivity}
        emailScope={emailScope}
        onEmailChanged={onEmailChanged}
        onResumeDraft={onResumeDraft}
        onDraftChanged={onDraftChanged}
      />

      <section aria-label={translateSales("history_259aa")}>
        <SectionHeading>{translateSales("history_0e769")}</SectionHeading>
        {(notesQuery.isPending || changesQuery.isPending) && (
          <p role="status" className="py-3 text-sm text-muted-foreground">
            {t("loadingHistory")}
          </p>
        )}
        {(notesQuery.isError || changesQuery.isError) && (
          <div
            role="alert"
            className="my-3 flex items-center justify-between gap-3 text-sm text-destructive"
          >
            <p>{t("historyFailed")}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void notesQuery.refetch();
                void changesQuery.refetch();
              }}
            >
              {t("retryHistory")}
            </Button>
          </div>
        )}
        <HistoryTypeTabs
          hideEmptyState={
            (tab === "notes" && (notesQuery.isPending || notesQuery.isError)) ||
            (tab === "changelog" && (changesQuery.isPending || changesQuery.isError)) ||
            (tab === "activities" && activityReadState !== "success")
          }
          tab={tab}
          onTab={onTab}
          counts={counts}
          items={historyByType}
          dealId={deal.id}
          onActivityChanged={onActivityChanged}
          onNoteChanged={onNoteChanged}
          onEditActivity={onEditActivity}
          emailScope={emailScope}
          emailEmptyLabel={emailTabStatusLabel(emailQuery, emailMessages)}
          onEmailChanged={onEmailChanged}
          onResumeDraft={onResumeDraft}
          onDraftChanged={onDraftChanged}
        />
      </section>
    </div>
  );
}
