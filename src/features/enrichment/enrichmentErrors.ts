import { ERROR_IDS } from "@/constants/errorIds";
import type { EnrichmentMessages } from "./enrichmentMessages";
import { failureReasonsText } from "./failureReasons";

export function runErrorMessage(
  id: string,
  context: Record<string, unknown> | undefined,
  messages: EnrichmentMessages,
  clock: (iso: string) => string,
): string {
  const S = messages.dialog;
  if (id === ERROR_IDS.ENRICH_NO_PROVIDER) return messages.button.notConfigured;
  if (id === ERROR_IDS.ENRICH_NO_IDENTIFIER) return S.noIdentifierError;
  if (id === ERROR_IDS.ENRICH_ALL_FAILED) {
    const reasons = failureReasonsText(context, messages);
    return reasons === null ? S.allFailedError : S.allFailedErrorReasons(reasons);
  }
  if (id === ERROR_IDS.ENRICH_UNSUPPORTED) return S.unsupportedError;
  if (id === ERROR_IDS.ENRICH_NOT_ENTITLED) return S.notEntitledError;
  if (id === ERROR_IDS.ENRICH_KEY_UNREADABLE) return S.keyUnreadableError;
  if (id === ERROR_IDS.ENRICH_THROTTLED) {
    const until = context?.earliestRetryIso;
    return typeof until === "string" && Number.isFinite(Date.parse(until))
      ? S.throttledError(clock(until))
      : S.throttledErrorUnknown;
  }
  return S.runError;
}
