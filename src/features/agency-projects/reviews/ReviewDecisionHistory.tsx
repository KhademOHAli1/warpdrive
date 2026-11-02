"use client";

import { type ReactNode, useId } from "react";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { directionForLocale } from "@/features/i18n/registry";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { formatDateTime } from "@/lib/localeFormatting";
import { agencyProjectsTranslator } from "../agencyProjectsMessages";
import { currentReviewApprovals } from "./reviewDecisions";
import type { ReviewDecision, ReviewSnapshot } from "./reviewTypes";

export type ReviewDecisionHistoryData = Readonly<{
  contextKey: string;
  review: ReviewSnapshot;
  userLabels: Readonly<Record<string, string>>;
  clientLabels: Readonly<Record<string, string>>;
}>;

// The authorized snapshot and its resolved labels share one read context. Server authority
// remains upstream; these presentation gates cannot authorize a read or a recorded decision.
export type ReviewDecisionHistoryProps = Readonly<{
  contextKey: string;
  target: Readonly<Pick<ReviewSnapshot, "projectId" | "deliverableId">> | null;
  canRead: boolean;
  data: ReviewDecisionHistoryData | null;
}>;

const PRIVATE = `${BLOCK_CLASS} ph-no-capture`;

export function ReviewDecisionHistory(props: ReviewDecisionHistoryProps) {
  const id = useId();
  const preferences = useLocalePreferences();
  const t = agencyProjectsTranslator(preferences.locale, preferences.numberingSystem);
  const { data, target } = props;
  if (
    !props.canRead ||
    props.contextKey.trim().length === 0 ||
    data === null ||
    target === null ||
    data.contextKey !== props.contextKey ||
    target.projectId !== data.review.projectId ||
    target.deliverableId !== data.review.deliverableId
  ) {
    return (
      <p role="alert" className={PRIVATE} dir={directionForLocale(preferences.locale)}>
        {t("reviewHistory.unavailable")}
      </p>
    );
  }
  const approvals = currentReviewApprovals(data.review);
  const current = new Set<ReviewDecision>([...approvals.internal, ...approvals.recordedClient]);
  return (
    <section
      aria-labelledby={`${id}-heading`}
      className={`${PRIVATE} space-y-4`}
      dir={directionForLocale(preferences.locale)}
    >
      <h2 id={`${id}-heading`} className="text-lg font-semibold">
        {t("reviewHistory.title")}
      </h2>
      <dl className="space-y-2">
        <HistoryDetail label={t("reviewHistory.currentVersion")}>
          <bdi>{data.review.currentVersionReference}</bdi>
        </HistoryDetail>
        <HistoryDetail label={t("reviewHistory.timeZone")}>
          <bdi>{preferences.timeZone}</bdi>
        </HistoryDetail>
      </dl>
      {current.size === 0 && <p>{t("reviewHistory.newReview")}</p>}
      {data.review.decisions.length === 0 ? (
        <p>{t("reviewHistory.empty")}</p>
      ) : (
        <ol className="space-y-3">
          {data.review.decisions.map((decision) => (
            <HistoryDecision
              key={`${decision.reviewEpoch}:${decision.recordedAtRevision}`}
              decision={decision}
              current={current.has(decision)}
              data={data}
            />
          ))}
        </ol>
      )}
    </section>
  );
}

function HistoryDecision({
  decision,
  current,
  data,
}: {
  decision: ReviewDecision;
  current: boolean;
  data: ReviewDecisionHistoryData;
}) {
  const preferences = useLocalePreferences();
  const t = agencyProjectsTranslator(preferences.locale, preferences.numberingSystem);
  const recorder = data.userLabels[decision.recordedByUserId];
  const knownRecorder = recorder !== undefined && recorder.trim().length > 0;
  const client = decision.kind === "staff-recorded-client-approval";
  const clientLabel = client ? data.clientLabels[decision.clientContactId] : undefined;
  return (
    <li className="space-y-3 rounded-lg border p-4">
      <p className="font-medium">
        {client
          ? knownRecorder
            ? t.rich("reviewHistory.clientApprovalRecorded", {
                staffName: recorder,
                staff: (name) => <bdi>{name}</bdi>,
              })
            : t("reviewHistory.clientApprovalRecordedUnknown")
          : t("reviewHistory.internalApproval")}
      </p>
      <p className="text-sm text-muted-foreground">
        {current ? t("reviewHistory.current") : t("reviewHistory.historical")}
      </p>
      <dl className="space-y-2">
        {!client && (
          <HistoryDetail label={t("reviewHistory.recordedBy")}>
            <bdi>{knownRecorder ? recorder : t("reviewHistory.staffUnavailable")}</bdi>
          </HistoryDetail>
        )}
        {client && (
          <HistoryDetail label={t("reviewHistory.clientContact")}>
            <bdi>
              {clientLabel !== undefined && clientLabel.trim().length > 0
                ? clientLabel
                : t("reviewHistory.clientUnavailable")}
            </bdi>
          </HistoryDetail>
        )}
        <HistoryDetail label={t("reviewHistory.reviewedVersion")}>
          <bdi>{decision.reviewedVersionReference}</bdi>
        </HistoryDetail>
        <HistoryDetail label={t("reviewHistory.method")}>
          {t(`reviewHistory.methods.${decision.method}`)}
        </HistoryDetail>
        <HistoryDetail
          label={t(client ? "reviewHistory.clientOccurred" : "reviewHistory.internalOccurred")}
        >
          <bdi>
            <time dateTime={decision.occurredAt}>
              {formatDateTime(decision.occurredAt, preferences)}
            </time>
          </bdi>
        </HistoryDetail>
        <HistoryDetail label={t("reviewHistory.recordedAt")}>
          <bdi>
            <time dateTime={decision.recordedAt}>
              {formatDateTime(decision.recordedAt, preferences)}
            </time>
          </bdi>
        </HistoryDetail>
        <HistoryDetail label={t("reviewHistory.evidence")}>
          <bdi>{decision.evidenceReference}</bdi>
        </HistoryDetail>
      </dl>
    </li>
  );
}

function HistoryDetail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="break-words [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}
