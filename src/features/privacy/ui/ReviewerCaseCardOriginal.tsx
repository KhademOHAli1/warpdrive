"use client";

import type { NativeSubjectReviewMessages } from "../privacyNativeSubjectReviewMessages";
import type { ReviewerCaseMessages } from "../privacyReviewerCaseMessages";
import type { PrivacyReviewerCase } from "../reviewerCaseTypes";
import { NativeSourceField } from "./NativeSubjectReviewField";

type Copy = { L: ReviewerCaseMessages; native: NativeSubjectReviewMessages };
export function ReviewerCaseReference({ label, value }: { label: string; value: string }) {
  return (
    <fieldset className="min-w-0 space-y-1">
      <legend className="text-sm text-muted-foreground">{label}</legend>
      <bdi dir="ltr" className="break-all text-sm">
        {value}
      </bdi>
    </fieldset>
  );
}
function OriginalReference({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>
        <bdi dir="ltr" className="break-all">
          {value}
        </bdi>
      </dd>
    </div>
  );
}
function OriginalSubject({
  subject,
  L,
  native,
}: Copy & { subject: PrivacyReviewerCase["request"]["subject"] }) {
  return (
    <>
      <NativeSourceField label={L.subject} value={L.subjectKinds[subject.kind]} L={native} />
      {subject.kind !== "external" && (
        <OriginalReference label={L.subjectReference} value={subject.referenceId} />
      )}
      <NativeSourceField label={L.subjectDetails} value={subject.description ?? null} L={native} />
    </>
  );
}
function OriginalRecipient({
  recipient,
  L,
  native,
}: Copy & { recipient: PrivacyReviewerCase["request"]["recipient"] }) {
  return (
    <>
      <NativeSourceField
        label={L.recipient}
        value={L.recipientKinds[recipient.channel]}
        L={native}
      />
      {recipient.channel === "in_app" ? (
        <OriginalReference label={L.recipientReference} value={recipient.userId} />
      ) : (
        <NativeSourceField
          label={L.recipientDetails}
          value={recipient.channel === "email" ? recipient.address : recipient.description}
          L={native}
        />
      )}
    </>
  );
}
export function ReviewerCaseCardOriginal({
  request,
  L,
  native,
}: Copy & { request: PrivacyReviewerCase["request"] }) {
  return (
    <fieldset className="min-w-0 space-y-3 rounded-md border p-4">
      <legend className="px-1 text-sm font-semibold">{L.original}</legend>
      <p className="text-sm text-muted-foreground">{L.originalNotice}</p>
      <dl className="space-y-3 text-sm">
        <NativeSourceField label={L.originalKind} value={L.kinds[request.kind]} L={native} />
        <NativeSourceField
          label={L.originalLocale}
          value={L.languages[request.locale]}
          L={native}
        />
        <NativeSourceField label={L.summary} value={request.summary} L={native} />
        <OriginalSubject subject={request.subject} L={L} native={native} />
        <OriginalRecipient recipient={request.recipient} L={L} native={native} />
      </dl>
    </fieldset>
  );
}
