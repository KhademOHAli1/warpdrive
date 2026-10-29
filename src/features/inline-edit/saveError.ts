import { createAppTranslator } from "@/features/i18n/catalog";
import type { Locale } from "@/features/i18n/registry";

// Maps the AppError id from a failed inline save to clear, user-facing copy so a denied or expired
// action reads as what it is, not a bare "Couldn't save". Ids come from src/constants/errorIds.ts;
// anything not listed (or a rejected promise with no id) falls back to the generic message.
const MESSAGES = {
  E_PERM_001: "permission",
  E_CONTACT_001: "missing",
  E_CONTACT_008: "invalid",
  E_AUTH_003: "session",
  E_AUTH_CSRF: "csrf",
} as const;

function errorMessageKey(errorId?: string) {
  return errorId !== undefined && Object.hasOwn(MESSAGES, errorId)
    ? MESSAGES[errorId as keyof typeof MESSAGES]
    : "generic";
}

export function saveErrorMessage(errorId?: string, locale: Locale = "en"): string {
  return createAppTranslator(locale, "shell.inline.errors")(errorMessageKey(errorId));
}
