import { render } from "@testing-library/react";
import { expect } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { LocalePreferences } from "@/features/i18n/preferences";
import { ReviewDecisionHistory, type ReviewDecisionHistoryProps } from "./ReviewDecisionHistory";
import { applyReviewCommand } from "./reviewDecisions";
import {
  clientContactId,
  internalReview,
  nativeRecorder,
  recordedClientApproval,
  snapshot,
} from "./reviewDecisions.test-support";
import type { ReviewCommand, ReviewSnapshot } from "./reviewTypes";

export const staffName = "Sara رضایی";
export const clientName = "Kunde Ä / مشتری";
export const secondClientId = "efabcdef-5678-4abc-8def-567890123abc";
export const secondClientName = "Studio Ö / همکار";
export const userLabels = { [nativeRecorder.recordedByUserId]: staffName };
export const clientLabels = {
  [clientContactId]: clientName,
  [secondClientId]: secondClientName,
};
export const occurredAt = "2026-11-01T09:10:00+03:30";
export const recordedAt = nativeRecorder.recordedAt;
export const historyContextKey = "accepted-staff-session:agency-workspace";

export function transition(review: ReviewSnapshot, command: ReviewCommand): ReviewSnapshot {
  const result = applyReviewCommand(review, command);
  expect(result.ok).toBe(true);
  return result.ok ? result.value.snapshot : review;
}

export function clientReview(
  review = snapshot(),
  overrides: Partial<Extract<ReviewCommand, { action: "record-client-approval" }>> = {},
): ReviewSnapshot {
  return transition(review, {
    ...recordedClientApproval(),
    expectedRevision: review.revision,
    reviewedVersionReference: review.currentVersionReference,
    ...overrides,
  });
}

export function internalReviewHistory(review = snapshot()): ReviewSnapshot {
  return transition(review, {
    ...internalReview(),
    expectedRevision: review.revision,
    reviewedVersionReference: review.currentVersionReference,
  });
}

export const englishPreferences: LocalePreferences = {
  locale: "en",
  calendar: "gregory",
  numberingSystem: "latn",
  timeZone: "UTC",
};

export function historyView(
  review: ReviewSnapshot,
  preferences: LocalePreferences = englishPreferences,
  labels: {
    userLabels: Readonly<Record<string, string>>;
    clientLabels: Readonly<Record<string, string>>;
  } = { userLabels, clientLabels },
  overrides: Partial<ReviewDecisionHistoryProps> = {},
) {
  return (
    <LocaleProvider {...preferences}>
      <ReviewDecisionHistory
        contextKey={historyContextKey}
        target={{ projectId: review.projectId, deliverableId: review.deliverableId }}
        canRead={true}
        data={{ contextKey: historyContextKey, review, ...labels }}
        {...overrides}
      />
    </LocaleProvider>
  );
}

export function renderHistory(
  review: ReviewSnapshot,
  preferences: LocalePreferences = englishPreferences,
) {
  return render(historyView(review, preferences));
}

// Proposed product copy for test-first implementation; native-language review is pending.
export const languageCases = [
  {
    locale: "fa",
    calendar: "gregory",
    numberingSystem: "latn",
    timeZone: "Europe/Berlin",
    title: "سوابق بررسی و تأیید",
    provenance: `تأیید مشتری، ثبت‌شده توسط ${staffName}`,
    method: "ایمیل",
    occurred: "زمان اعلام تأیید",
    recorded: "زمان ثبت",
  },
  {
    locale: "de",
    calendar: "persian",
    numberingSystem: "arabext",
    timeZone: "America/New_York",
    title: "Verlauf der Freigaben",
    provenance: `Kundenfreigabe, erfasst von ${staffName}`,
    method: "E-Mail",
    occurred: "Zeitpunkt der Mitteilung",
    recorded: "Erfasst am",
  },
  {
    locale: "en",
    calendar: "persian",
    numberingSystem: "arabext",
    timeZone: "Asia/Tehran",
    title: "Review decision history",
    provenance: `Client approval recorded by ${staffName}`,
    method: "Email",
    occurred: "Approval reported at",
    recorded: "Recorded at",
  },
] as const;
