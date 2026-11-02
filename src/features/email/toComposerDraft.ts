import type { SendEmailOutcome } from "@/types/mail";
import type { AttachedFile } from "./composer/AttachmentList";
import type { DraftSummary } from "./draftRepo";

export interface ComposerDraftSeed {
  id: string;
  accountId?: string;
  bcc?: string[];
  attachments?: AttachedFile[];
  sendIntentId?: string;
  trackOpens?: boolean;
  trackLinks?: boolean;
  sendOutcome?: SendEmailOutcome;
  subject: string;
  bodyHtml: string;
  to: string[];
  cc: string[];
  threadId?: string | null;
  visibility: DraftSummary["visibility"];
  linkDealId: string | null;
  linkPersonId: string | null;
}

// Shape Composer's `draft` seed prop expects. The CRM links travel with it: in the Drafts folder
// the composer has no record context of its own, so the row is the only thing that knows which
// deal the message was written for.
export function toComposerDraft(d: DraftSummary): ComposerDraftSeed {
  return {
    id: d.id,
    accountId: d.accountId,
    bcc: d.bccEmails,
    attachments: d.attachments,
    sendIntentId: d.sendIntentId,
    trackOpens: d.trackOpens,
    trackLinks: d.trackLinks,
    sendOutcome: d.sendOutcome,
    subject: d.subject ?? "",
    bodyHtml: d.bodyHtml ?? "",
    to: d.toEmails,
    cc: d.ccEmails,
    threadId: d.threadId,
    visibility: d.visibility,
    linkDealId: d.linkDealId,
    linkPersonId: d.linkPersonId,
  };
}
