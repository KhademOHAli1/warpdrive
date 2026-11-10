"use client";

import { useFormatters } from "@/lib/useFormatters";
import type { NativeSubjectReviewMessages } from "../privacyNativeSubjectReviewMessages";
import type { ReviewerCaseMessages } from "../privacyReviewerCaseMessages";
import type { PrivacyReviewerCase } from "../reviewerCaseTypes";
import { NativeSourceField } from "./NativeSubjectReviewField";
import { ReviewerCaseCardOriginal, ReviewerCaseReference } from "./ReviewerCaseCardOriginal";

export function ReviewerCaseCardDetails({
  row,
  L,
  native,
}: {
  row: PrivacyReviewerCase;
  L: ReviewerCaseMessages;
  native: NativeSubjectReviewMessages;
}) {
  const format = useFormatters();
  return (
    <div className="space-y-4">
      <ReviewerCaseReference label={L.reference} value={row.case.id} />
      <dl className="space-y-3 text-sm">
        <NativeSourceField label={L.currentKind} value={L.kinds[row.case.kind]} L={native} />
        <NativeSourceField label={L.currentStatus} value={L.states[row.case.status]} L={native} />
        <NativeSourceField label={L.revision} value={format.number(row.case.version)} L={native} />
        <NativeSourceField
          label={L.received}
          value={format.dateTime(row.case.receivedAt)}
          L={native}
        />
        <NativeSourceField
          label={L.due}
          value={row.case.dueAt === null ? null : format.dateTime(row.case.dueAt)}
          L={native}
        />
        <NativeSourceField
          label={L.identity}
          value={row.identity.state === "current" ? L.current : L.reviewRequired}
          L={native}
        />
        <NativeSourceField
          label={L.casePolicy}
          value={row.case.policyVersion === null ? null : format.number(row.case.policyVersion)}
          L={native}
        />
        <NativeSourceField
          label={L.activePolicy}
          value={
            row.policy.activeVersion === null
              ? L.unconfigured
              : format.number(row.policy.activeVersion)
          }
          L={native}
        />
      </dl>
      <p className="text-sm text-muted-foreground">{L.identityHelp}</p>
      <ReviewerCaseCardOriginal request={row.request} L={L} native={native} />
    </div>
  );
}
