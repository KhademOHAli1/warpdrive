"use client";

import { useRouter } from "next/navigation";
import type React from "react";
import { ERROR_IDS } from "@/constants/errorIds";
import { DealInlineTextField } from "@/features/deal-workspace/DealInlineTextField";
import { dealClientResult } from "@/features/deals/dealClientResult";
import { updateDealAction } from "@/features/deals/updateAction";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { err, ok, type Result } from "@/types/result";
import { readCsrfToken } from "@/utils/csrfCookie";
import { FieldRow } from "./FieldRow";

interface SourceChannelIdFieldProps {
  dealId: string;
  writeVersion: string;
  sourceChannelId: string | null;
}

// Free-text external source identifier (Source section). Inline-editable through updateDealAction
// under the deal's CAS precondition; refresh on both branches so a stale CAS picks up the advanced
// writeVersion next render. Mirrors SourceChannelField but a text value rather than a fixed enum.
export function SourceChannelIdField({
  dealId,
  writeVersion,
  sourceChannelId,
}: SourceChannelIdFieldProps): React.ReactNode {
  const translateSales = useAppTranslations("sales");

  const router = useRouter();

  async function save(
    value: string,
    expectedWriteVersion: string,
  ): Promise<Result<unknown, string>> {
    const trimmed = value.trim();
    const r = await dealClientResult(() =>
      updateDealAction(
        { dealId, expectedWriteVersion, sourceChannelId: trimmed === "" ? null : trimmed },
        readCsrfToken(),
      ),
    );
    if (r.ok || r.error.id === ERROR_IDS.DEAL_PRECONDITION) router.refresh();
    return r.ok ? ok(r.deal) : err(r.error.id);
  }

  return (
    <FieldRow label={translateSales("channel_id_8edd6")} empty={sourceChannelId === null}>
      <DealInlineTextField
        writeVersion={writeVersion}
        label={translateSales("channel_id_8edd6")}
        value={sourceChannelId ?? ""}
        onSave={save}
      />
    </FieldRow>
  );
}
