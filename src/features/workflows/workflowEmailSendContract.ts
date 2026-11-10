import { workflowEmailDraftCompose, workflowEmailDraftConfig } from "./workflowEmailDraftContract";

// Mailbox and compose fields share Draft Email's bounded, typed input grammar.
// Send carries no custom From, raw HTML, tracking, attachments, or reply context.
export const workflowEmailSendConfig = workflowEmailDraftConfig;
export type WorkflowEmailSendConfig = ReturnType<typeof workflowEmailSendConfig.parse>;

// The native outbox stores JSONB and cannot preserve lone UTF-16 surrogates.
export const workflowEmailSendCompose = workflowEmailDraftCompose.refine(
  ({ to, cc, bcc, subject, body }) =>
    [...to, ...cc, ...bcc, subject, body].every((value) => !/[\uD800-\uDFFF]/u.test(value)),
);
