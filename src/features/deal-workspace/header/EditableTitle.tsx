"use client";

import { useRouter } from "next/navigation";
import type React from "react";
import { ERROR_IDS } from "@/constants/errorIds";
import { DealEditableHeading } from "@/features/deal-workspace/DealEditableHeading";
import { dealClientResult } from "@/features/deals/dealClientResult";
import { updateDealAction } from "@/features/deals/updateAction";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import type { InlineSaveResult } from "@/features/inline-edit/useInlineEditField";
import { readCsrfToken } from "@/utils/csrfCookie";

interface EditableTitleProps {
  dealId: string;
  title: string;
  // Opaque version of the displayed deal snapshot.
  expectedWriteVersion: string;
}

// Deal-title variant of the shared inline field. Only calls the action when the value changed and
// is non-empty (schema requires 1..255).
export function EditableTitle({
  dealId,
  title,
  expectedWriteVersion,
}: EditableTitleProps): React.ReactNode {
  const translateSales = useAppTranslations("sales");

  const router = useRouter();

  async function commit(next: string, version: string): Promise<InlineSaveResult> {
    const r = await dealClientResult(() =>
      updateDealAction({ dealId, expectedWriteVersion: version, title: next }, readCsrfToken()),
    );
    if (r.ok || r.error.id === ERROR_IDS.DEAL_PRECONDITION) router.refresh();
    return r.ok ? { ok: true, value: undefined } : { ok: false, error: r.error.id };
  }

  return (
    <DealEditableHeading
      writeVersion={expectedWriteVersion}
      title={title}
      label={translateSales("deal_title_890fc")}
      onCommit={commit}
    />
  );
}
