import { ERROR_IDS, type ErrorId } from "@/constants/errorIds";
import { PROSPECT_SELECTION_MAX } from "@/constants/prospectSearch";
import {
  type EnrichmentMessages,
  enrichmentMessagesForLocale,
  PROVIDER_NAMES,
} from "../enrichmentMessages";
import type { ProviderOutcome } from "../providers/types";

export interface SearchMessage {
  title: string;
  body: string;
}

export function messageForErrorId(
  errorId: string,
  orgName: string,
  messages: EnrichmentMessages = enrichmentMessagesForLocale("en"),
): SearchMessage {
  const S = messages.prospects;
  if (errorId === ERROR_IDS.ENRICH_ORG_NO_DOMAIN) {
    return { title: S.noDomainTitle, body: S.noDomainBody };
  }
  if (errorId === ERROR_IDS.ENRICH_NO_SEARCH_PROVIDER) {
    return { title: S.noProviderTitle, body: S.noProviderBody };
  }
  return { title: S.emptyTitle(orgName), body: messages.dialog.runError };
}

export function messageForOutcome(
  outcome: ProviderOutcome,
  orgName: string,
  messages: EnrichmentMessages = enrichmentMessagesForLocale("en"),
): SearchMessage | null {
  const S = messages.prospects;
  const { kind, provider } = outcome;
  if (kind === "ok") return null;
  if (kind === "no_match") return { title: S.emptyTitle(orgName), body: S.emptyBody };
  if (kind === "not_entitled") {
    return { title: S.noProviderTitle, body: S.notEntitled(PROVIDER_NAMES[provider]) };
  }
  if (kind === "quota") return { title: S.noProviderTitle, body: messages.quotaError };
  if (kind === "throttled") {
    return { title: S.noProviderTitle, body: messages.dialog.throttledErrorUnknown };
  }
  if (kind === "auth" || kind === "key_unreadable") {
    return { title: S.noProviderTitle, body: messages.dialog.keyUnreadableError };
  }
  return {
    title: S.emptyTitle(orgName),
    // Provider diagnostics may contain English/internal response prose. The stable kind controls
    // the UI explanation; the original outcome stays available to operational diagnostics.
    body: messages.providerError,
  };
}

export function revealErrorMessage(
  errorId: string,
  messages: EnrichmentMessages = enrichmentMessagesForLocale("en"),
): string {
  const S = messages.prospects;
  if (errorId === ERROR_IDS.ENRICH_SELECTION_TOO_LARGE) {
    return S.selectionFull(PROSPECT_SELECTION_MAX);
  }
  if (errorId === ERROR_IDS.PERM_DENIED) return S.itemDenied;
  if (errorId === ERROR_IDS.ENRICH_NO_PROVIDER) return S.noProviderBody;
  if (errorId === ERROR_IDS.ENRICH_THROTTLED) {
    return messages.dialog.throttledErrorUnknown;
  }
  return S.revealFailed;
}

// Server action error ids cross a serialization boundary as strings. Only the codes with a
// specific safe UI explanation travel through the queue; unknown ids/prose use the generic code.
export function revealErrorId(id: string): ErrorId {
  switch (id) {
    case ERROR_IDS.ENRICH_SELECTION_TOO_LARGE:
    case ERROR_IDS.PERM_DENIED:
    case ERROR_IDS.ENRICH_NO_PROVIDER:
    case ERROR_IDS.ENRICH_THROTTLED:
      return id;
    default:
      return ERROR_IDS.ENRICH_ALL_FAILED;
  }
}
