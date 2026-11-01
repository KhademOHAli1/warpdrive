import type { EmailVisibility } from "../threadVisibility";
export type DraftSaveState = "idle" | "saving" | "saved" | "error";
export interface DraftAutosaveDeps {
  accountId: string;
  threadId: string | null;
  subject: string;
  body: string;
  toList: string[];
  ccList: string[];
  bccList?: string[];
  attachments?: { fileId: string }[];
  sendIntentId?: string;
  trackOpens?: boolean;
  trackLinks?: boolean;
  visibility: EmailVisibility;
  linkDealId?: string;
  linkPersonId?: string;
  initialDraftId: string | undefined;
  draftIdRef: { current: string | undefined };
  inFlightRef: { current: Promise<void> | null };
  enabled?: boolean;
}
