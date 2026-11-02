"use client";
import { useRouter } from "next/navigation";
import type React from "react";
import { ERROR_IDS } from "@/constants/errorIds";
import type { InlineSaveResult } from "@/features/inline-edit/useInlineEditField";
import type { CustomFieldDef } from "@/types/customFields";
import { DealInlineCustomFieldEditor } from "../DealInlineCustomFieldEditor";
import type { CustomFieldsSave } from "./customFieldsSave";

export function InlineCustomField({
  onSave,
  writeVersion,
  def,
  value,
  currency,
  initiallyEditing = false,
}: {
  onSave: CustomFieldsSave;
  writeVersion: string;
  def: CustomFieldDef;
  value: unknown;
  currency: string;
  initiallyEditing?: boolean;
}): React.ReactNode {
  const router = useRouter();

  async function save(draft: unknown, expectedWriteVersion: string): Promise<InlineSaveResult> {
    const r = await onSave({ [def.key]: draft }, expectedWriteVersion);
    if (r.ok || r.error === ERROR_IDS.DEAL_PRECONDITION) router.refresh();
    return r;
  }

  return (
    <DealInlineCustomFieldEditor
      writeVersion={writeVersion}
      initiallyEditing={initiallyEditing}
      def={def}
      value={value}
      currency={currency}
      onSave={save}
    />
  );
}
