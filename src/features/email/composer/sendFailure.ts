import { ERROR_IDS } from "@/constants/errorIds";
import { type EmailMessages, emailMessagesForLocale } from "../emailMessages";
export function sendFailureMessage(
  errorId: string,
  messages: EmailMessages = emailMessagesForLocale("en"),
): string {
  const causes: Record<string, string> = {
    [ERROR_IDS.UI_STALE_BUILD]: messages._sendErrors.stale,
    [ERROR_IDS.UI_ACTION_UNCONFIRMED]: messages._composer.sendUnconfirmed,
    [ERROR_IDS.PERM_DENIED]: messages._sendErrors.session,
    [ERROR_IDS.GMAIL_GRANT_REVOKED]: messages._sendErrors.revoked,
    [ERROR_IDS.GMAIL_TOKEN_DECRYPT_FAILED]: messages._sendErrors.credentials,
    [ERROR_IDS.GMAIL_ATTACHMENT_DENIED]: messages._sendErrors.attachment,
    [ERROR_IDS.GMAIL_SEND_INPUT_INVALID]: messages._sendErrors.input,
  };
  return causes[errorId] ?? messages.errorSend;
}
