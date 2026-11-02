"use client";

import { type FormEvent, useId, useState } from "react";
import { z } from "zod";
import {
  SettingsCard,
  SettingsCardBody,
  SettingsCardHeader,
} from "@/app/(app)/settings/SettingsSurface";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { directionForLocale } from "@/features/i18n/registry";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { privacyNativeSubjectReviewMessagesForLocale } from "../privacyNativeSubjectReviewMessages";
import {
  NativeSubjectReviewCard,
  type NativeSubjectReviewCardProps,
} from "./NativeSubjectReviewCard";

export type ReviewerCaseReferenceEntryProps = Omit<NativeSubjectReviewCardProps, "caseId">;
const caseReferenceSchema = z.uuid();
type Selection = { boundary: string; input: string; caseId: string | null; invalid: boolean };
const emptySelection = (boundary: string): Selection => ({
  boundary,
  input: "",
  caseId: null,
  invalid: false,
});

export function ReviewerCaseReferenceEntry(props: ReviewerCaseReferenceEntryProps) {
  const locale = useLocale();
  const L = privacyNativeSubjectReviewMessagesForLocale(locale);
  const referenceId = useId();
  const [reviewerId] = useState(props.securityStatus.user.id);
  const status = props.securityStatus;
  const boundary = JSON.stringify([
    status.user.id,
    status.emailVerified,
    status.fresh,
    status.needsMfa,
    status.needsEnrollment,
    props.securityUnavailable === true,
  ]);
  const [selection, setSelection] = useState<Selection>(() => emptySelection(boundary));
  if (selection.boundary !== boundary) setSelection(emptySelection(boundary));
  const accountChanged = status.user.id !== reviewerId;
  const disabled =
    props.securityUnavailable === true ||
    accountChanged ||
    !status.emailVerified ||
    !status.fresh ||
    status.needsMfa ||
    status.needsEnrollment;
  const current = selection.boundary === boundary;
  const selectedCaseId = current && !disabled ? selection.caseId : null;
  const invalid = current && selection.invalid;

  function open(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled) return;
    const parsed = caseReferenceSchema.safeParse(selection.input.trim().toLowerCase());
    setSelection((previous) =>
      previous.boundary !== boundary
        ? previous
        : {
            ...previous,
            caseId: parsed.success ? parsed.data : null,
            invalid: !parsed.success,
          },
    );
  }

  return (
    <div dir={directionForLocale(locale)} className={`space-y-4 ${BLOCK_CLASS} ph-no-capture`}>
      <SettingsCard>
        <SettingsCardHeader title={L.entryTitle} />
        <SettingsCardBody>
          <form onSubmit={open} className="space-y-3">
            <label htmlFor={referenceId} className="text-sm font-medium">
              {L.entryReference}
            </label>
            <Input
              id={referenceId}
              value={current ? selection.input : ""}
              dir="ltr"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={invalid || undefined}
              aria-describedby={`${referenceId}-help${invalid ? ` ${referenceId}-error` : ""}`}
              onChange={(event) =>
                setSelection({ boundary, input: event.target.value, caseId: null, invalid: false })
              }
            />
            <p id={`${referenceId}-help`} className="text-sm text-muted-foreground">
              {L.entryHelp}
            </p>
            {invalid && (
              <p id={`${referenceId}-error`} role="alert" className="text-sm text-destructive">
                {L.entryInvalid}
              </p>
            )}
            {accountChanged && <p className="text-sm text-muted-foreground">{L.account}</p>}
            {!accountChanged && !status.emailVerified && (
              <p className="text-sm text-muted-foreground">{L.verifyEmail}</p>
            )}
            <Button type="submit" variant="outline" disabled={disabled}>
              {L.entryOpen}
            </Button>
          </form>
        </SettingsCardBody>
      </SettingsCard>
      {selectedCaseId !== null && (
        <NativeSubjectReviewCard
          key={selectedCaseId}
          caseId={selectedCaseId}
          securityStatus={status}
          refreshSecurity={props.refreshSecurity}
          securityUnavailable={props.securityUnavailable === true}
        />
      )}
    </div>
  );
}
