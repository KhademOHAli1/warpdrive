"use client";

import { useFormatters } from "@/lib/useFormatters";
import type { PrivacyNativeSubjectReview } from "../nativeSubjectReviewTypes";
import type { NativeSubjectReviewMessages } from "../privacyNativeSubjectReviewMessages";
import { NativeSourceField, NativeSourcePoints } from "./NativeSubjectReviewField";

type Props = { row: PrivacyNativeSubjectReview; L: NativeSubjectReviewMessages };
function NativeDates({
  values,
  L,
}: {
  values: { createdAt: string | null; updatedAt: string | null };
  L: NativeSubjectReviewMessages;
}) {
  const format = useFormatters();
  return (
    <>
      <NativeSourceField
        label={L.created}
        value={values.createdAt === null ? null : format.dateTime(values.createdAt)}
        L={L}
      />
      <NativeSourceField
        label={L.updated}
        value={values.updatedAt === null ? null : format.dateTime(values.updatedAt)}
        L={L}
      />
    </>
  );
}
export function NativeSubjectReviewDetails({ row, L }: Props) {
  const format = useFormatters();
  const record = row.record;
  return (
    <div className="space-y-4">
      <dl className="space-y-3 text-sm">
        <div>
          <dt className="text-muted-foreground">{L.caseReference}</dt>
          <dd>
            <bdi dir="ltr">{row.binding.caseId}</bdi>
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{L.subjectReference}</dt>
          <dd>
            <bdi dir="ltr">{row.binding.subject.referenceId}</bdi>
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{L.sourceType}</dt>
          <dd>{record.store === "persons" ? L.person : L.user}</dd>
        </div>
        <NativeSourceField label={L.name} value={record.values.name} L={L} />
        {record.store === "persons" ? (
          <>
            <NativeSourceField label={L.firstName} value={record.values.firstName} L={L} />
            <NativeSourceField label={L.lastName} value={record.values.lastName} L={L} />
            <NativeSourceField label={L.primaryEmail} value={record.values.primaryEmail} L={L} />
            <NativeSourcePoints label={L.emails} points={record.values.emails} L={L} />
            <NativeSourcePoints label={L.phones} points={record.values.phones} L={L} />
            <NativeDates values={record.values} L={L} />
            <NativeSourceField
              label={L.deleted}
              value={
                record.values.deletedAt === null ? null : format.dateTime(record.values.deletedAt)
              }
              L={L}
            />
          </>
        ) : (
          <>
            <NativeSourceField label={L.email} value={record.values.email} L={L} />
            <NativeDates values={record.values} L={L} />
          </>
        )}
      </dl>
      <p className="text-sm text-muted-foreground">{L.coverageHelp}</p>
    </div>
  );
}
