"use client";

import { useRouter } from "next/navigation";
import { ERROR_IDS } from "@/constants/errorIds";
import { sourceChannelOptions } from "@/constants/sourceChannelLabels";
import { isSourceChannelKey, type SourceChannelKey } from "@/constants/sourceChannels";
import { DealInlineSelectField } from "@/features/deal-workspace/DealInlineSelectField";
import { dealClientResult } from "@/features/deals/dealClientResult";
import { updateDealAction } from "@/features/deals/updateAction";
import { useAppTranslations, useLocale } from "@/features/i18n/LocaleProvider";
import { err, ok, type Result } from "@/types/result";
import { readCsrfToken } from "@/utils/csrfCookie";
import { FieldRow } from "./FieldRow";

interface SourceChannelFieldProps {
  dealId: string;
  writeVersion: string;
  sourceChannel: string | null;
}

export function SourceChannelField({
  dealId,
  writeVersion,
  sourceChannel,
}: SourceChannelFieldProps) {
  const translateSales = useAppTranslations("sales");
  const locale = useLocale();

  const router = useRouter();
  const channelValue =
    sourceChannel !== null && isSourceChannelKey(sourceChannel) ? sourceChannel : "";

  async function save(
    value: string,
    expectedWriteVersion: string,
  ): Promise<Result<unknown, string>> {
    const next = value === "" ? null : (value as SourceChannelKey);
    const r = await dealClientResult(() =>
      updateDealAction({ dealId, expectedWriteVersion, sourceChannel: next }, readCsrfToken()),
    );
    if (r.ok || r.error.id === ERROR_IDS.DEAL_PRECONDITION) router.refresh();
    return r.ok ? ok(r.deal) : err(r.error.id);
  }

  return (
    <FieldRow label={translateSales("channel_ce468")}>
      <DealInlineSelectField
        writeVersion={writeVersion}
        label={translateSales("channel_ce468")}
        value={channelValue}
        options={[
          { value: "", label: translateSales("computed.none") },
          ...sourceChannelOptions(locale),
        ]}
        onSave={save}
      />
    </FieldRow>
  );
}
