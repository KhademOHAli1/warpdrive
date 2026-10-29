import { type EmailMessages, emailMessagesForLocale } from "./emailMessages";

// A record's Email filter shows one line when it has nothing to list, so that line has to say WHICH
// of the three states it is in. Returns undefined once the read has settled with a real answer, so
// the surface falls back to its own "no emails linked" copy.
// isLoading, not isPending: a disabled query (an organization, which owns no threads) is pending
// forever and must keep its own explanation instead of reading as a stuck load.
export function emailTabStatusLabel(
  query: {
    isLoading: boolean;
    isError: boolean;
  },
  messages: EmailMessages = emailMessagesForLocale("en"),
): string | undefined {
  if (query.isError) return messages.emailListFailed;
  if (query.isLoading) return messages.loadingEmails;
  return undefined;
}
