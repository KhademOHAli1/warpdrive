"use client";

import type React from "react";
import { useRef } from "react";
import { reportTimePickerValidity } from "@/components/ui/timePickerValidity";
import { ERROR_IDS } from "@/constants/errorIds";
import { customFieldDraftError } from "@/features/custom-fields/inputValidation";
import {
  CustomFieldDetail,
  CustomFieldFormControl,
  isCustomFieldValueEmpty,
} from "@/features/custom-fields/render";
import { useAppTranslations, useLocale } from "@/features/i18n/LocaleProvider";
import { InlineEditFooter } from "@/features/inline-edit/InlineEditFooter";
import { InlineFieldShell } from "@/features/inline-edit/InlineFieldShell";
import type { CustomFieldDef } from "@/types/customFields";
import { dealEditErrorMessage as saveErrorMessage } from "./dealEditErrorMessage";
import { type DealInlineSaveFn, useDealEditSnapshot } from "./useDealEditSnapshot";

// Deal-specific custom-field editor, reusing shared controls while retaining the original
// write token with its draft. Other entity editors keep their existing contract.
export function DealInlineCustomFieldEditor({
  def,
  value,
  currency,
  writeVersion,
  onSave,
  initiallyEditing = false,
}: {
  def: CustomFieldDef;
  value: unknown;
  currency: string;
  writeVersion: string;
  onSave: DealInlineSaveFn<unknown>;
  initiallyEditing?: boolean;
}): React.ReactNode {
  const locale = useLocale();
  const t = useAppTranslations("customFields");
  const field = useDealEditSnapshot<unknown>(value, writeVersion, initiallyEditing);
  const fieldsRef = useRef<HTMLDivElement>(null);
  const dirty = JSON.stringify(field.draft ?? null) !== JSON.stringify(value ?? null);

  const clientError =
    field.editing && dirty ? customFieldDraftError(def, field.draft, locale) : null;
  const serverError =
    field.error === ERROR_IDS.CF_VALUE_INVALID
      ? (customFieldDraftError(def, field.draft, locale) ?? saveErrorMessage(field.error, locale))
      : field.error === null
        ? null
        : saveErrorMessage(field.error, locale);
  const editor = field.editing ? (
    <div ref={fieldsRef} className="flex flex-col gap-1.5">
      <CustomFieldFormControl
        def={def}
        currency={currency}
        hideValidationMessage
        value={field.draft}
        onChange={(next) => field.setDraft(next)}
      />
      {clientError !== null ? (
        <span role="alert" className="text-destructive text-xs">
          {clientError}
        </span>
      ) : null}
      <InlineEditFooter
        onCancel={field.cancel}
        onSave={() => {
          if (clientError === null && reportTimePickerValidity(fieldsRef.current))
            field.commit(onSave);
        }}
        saveDisabled={!dirty || clientError !== null}
        pending={field.pending}
      />
    </div>
  ) : null;

  return (
    <div>
      {serverError !== null && (
        <p role="alert" className="text-xs text-destructive">
          {serverError}
        </p>
      )}
      {field.pending ? (
        <p role="status" className="text-xs text-muted-foreground">
          {t("saving")}
        </p>
      ) : (
        <InlineFieldShell
          label={def.name}
          editing={field.editing}
          onStartEdit={field.start}
          value={
            isCustomFieldValueEmpty(value) ? (
              "-"
            ) : (
              <CustomFieldDetail def={def} value={value} currency={currency} />
            )
          }
        >
          {editor}
        </InlineFieldShell>
      )}
    </div>
  );
}
