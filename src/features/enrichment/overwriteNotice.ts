import { COMPANY_NAME_KEY } from "./canonicalKeys";
import { type EnrichmentMessages, enrichmentMessagesForLocale } from "./enrichmentMessages";
import type { ProposedField } from "./types";

export function overwriteNotice(
  field: ProposedField,
  messages: EnrichmentMessages = enrichmentMessagesForLocale("en"),
): string | null {
  const S = messages.dialog;
  if (!field.isOverwrite) return null;
  if (field.currentValue === null) return S.overwritesHidden;
  const current = String(field.currentValue);
  return field.canonicalKey === COMPANY_NAME_KEY
    ? S.relinksOrganization(current)
    : S.overwrites(current);
}
