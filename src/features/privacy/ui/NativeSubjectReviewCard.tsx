"use client";

import {
  SettingsCard,
  SettingsCardBody,
  SettingsCardHeader,
} from "@/app/(app)/settings/SettingsSurface";
import { Button } from "@/components/ui/Button";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { directionForLocale } from "@/features/i18n/registry";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { privacyNativeSubjectReviewMessagesForLocale } from "../privacyNativeSubjectReviewMessages";
import { NativeSubjectReviewDetails } from "./NativeSubjectReviewDetails";
import type { NativeSubjectReviewCardProps } from "./nativeSubjectReviewCardModel";
import { useNativeSubjectReview } from "./useNativeSubjectReview";

export type { NativeSubjectReviewCardProps } from "./nativeSubjectReviewCardModel";

export function NativeSubjectReviewCard(props: NativeSubjectReviewCardProps) {
  const locale = useLocale();
  const L = privacyNativeSubjectReviewMessagesForLocale(locale);
  const task = useNativeSubjectReview(props);
  return (
    <div dir={directionForLocale(locale)} className={`${BLOCK_CLASS} ph-no-capture`}>
      <SettingsCard>
        <SettingsCardHeader title={L.title} description={L.description} />
        <SettingsCardBody className="space-y-4">
          {task.busy && (
            <p role="status" className="text-sm text-muted-foreground">
              {L.loading}
            </p>
          )}
          {task.error !== null && (
            <p role="alert" className="text-sm text-destructive">
              {L[task.error]}
            </p>
          )}
          {task.data !== null && (
            <>
              <p className="text-sm">{L.notice}</p>
              <NativeSubjectReviewDetails row={task.data} L={L} />
            </>
          )}
          <Button variant="outline" disabled={task.disabled} onClick={task.load}>
            {task.data === null ? L.load : L.refresh}
          </Button>
        </SettingsCardBody>
      </SettingsCard>
    </div>
  );
}
