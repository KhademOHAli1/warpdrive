import { isSourceChannelKey } from "@/constants/sourceChannels";
import { createAppTranslator } from "@/features/i18n/catalog";
import type { Locale } from "@/features/i18n/registry";
import { orNull, parseMoneyValue } from "@/utils/entityFormFields";
import type { LeadCreateInput } from "./schemas";

export type ParseLeadResult = { ok: true; input: LeadCreateInput } | { ok: false; error: string };

export interface NewLeadFields {
  title: string;
  value: string;
  personId?: string | null;
  orgId?: string | null;
  labels?: string[];
  sourceChannel?: string | null;
  sourceChannelId?: string | null;
  expectedCloseDate?: string | null;
  ownerId?: string | null;
  visibilityGroupId?: string | null;
}

// Validate the Add lead form into a LeadCreateInput. Trust-boundary fields (visibility) are derived
// server-side; ownerId is honored server-side only for actors with deal.changeOwner.
export function parseNewLead(
  fields: NewLeadFields,
  locale: Locale = "en",
  valueLocale: Locale = locale,
): ParseLeadResult {
  const t = createAppTranslator(locale, "leads");
  const title = fields.title.trim();
  if (title === "") return { ok: false, error: t("titleRequired") };

  const money = parseMoneyValue(fields.value, valueLocale);
  if (!money.ok) return { ok: false, error: locale === "en" ? money.error : t("validNumber") };
  // Labels are user-managed catalog names now (not a fixed key set), so accept any provided value
  // and just dedupe.
  const labels = [...new Set(fields.labels ?? [])];
  const channelRaw = orNull(fields.sourceChannel);
  const sourceChannel = channelRaw !== null && isSourceChannelKey(channelRaw) ? channelRaw : null;
  const ownerId = orNull(fields.ownerId);
  const visibilityGroupId = orNull(fields.visibilityGroupId);

  return {
    ok: true,
    input: {
      title,
      value: money.value,
      personId: orNull(fields.personId),
      orgId: orNull(fields.orgId),
      expectedCloseDate: orNull(fields.expectedCloseDate),
      labels,
      sourceChannel,
      sourceChannelId: orNull(fields.sourceChannelId),
      sourceOrigin: "manually_created",
      ...(ownerId !== null ? { ownerId } : {}),
      ...(visibilityGroupId !== null ? { visibilityGroupId } : {}),
    },
  };
}
