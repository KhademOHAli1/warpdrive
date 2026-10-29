"use client";
import { useRouter } from "next/navigation";
import { sourceChannelOptions } from "@/constants/sourceChannelLabels";
import { isSourceChannelKey, type SourceChannelKey } from "@/constants/sourceChannels";
import { updateDealAction } from "@/features/deals/updateAction";
import { useAppTranslations, useLocale } from "@/features/i18n/LocaleProvider";
import { InlineSelectField } from "@/features/inline-edit/InlineSelectField";
import { err, ok, type Result } from "@/types/result";
import { readCsrfToken } from "@/utils/csrfCookie";
import { FieldRow } from "./FieldRow";

interface SourceChannelFieldProps {
  dealId: string;
  updatedAt: string | Date;
  sourceChannel: string | null;
}

export function SourceChannelField({ dealId, updatedAt, sourceChannel }: SourceChannelFieldProps) {
  const translateSales = useAppTranslations("sales");
  const locale = useLocale();

  const router = useRouter();
  const expectedUpdatedAt = new Date(updatedAt).toISOString();
  const channelValue =
    sourceChannel !== null && isSourceChannelKey(sourceChannel) ? sourceChannel : "";

  async function save(value: string): Promise<Result<unknown, string>> {
    const next = value === "" ? null : (value as SourceChannelKey);
    const r = await updateDealAction(
      { dealId, expectedUpdatedAt, sourceChannel: next },
      readCsrfToken(),
    );
    router.refresh();
    return r.ok ? ok(r.deal) : err(r.error.id);
  }

  return (
    <FieldRow label={translateSales("channel_ce468")}>
      <InlineSelectField
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
