import type { StorageClient } from "@/features/files/storage";
import type { ImapConnectionRuntime } from "./mailConnectionRuntime";
import type { SendPayload } from "./outboxClaim";

export interface SmtpDeliveryOutcome {
  state: "accepted" | "partial" | "unknown" | "rejected";
  accepted?: string[];
  rejected?: string[];
}
export interface PreparedSmtpAttachment {
  fileId: string;
  objectKey: string;
  sha256: string;
  filename: string;
  contentType: string;
  size: number;
  ready: boolean;
}
export interface SmtpReceipt extends SmtpDeliveryOutcome {
  preparedAttachments?: PreparedSmtpAttachment[];
  inReplyTo?: string | null;
  references?: string[];
  semanticFingerprint?: string;
  mimeDate?: string;
  sentCopy?: {
    state: "started" | "complete" | "failed" | "unknown";
    folderPath: string;
    uid?: number;
    uidValidity?: string;
  };
}
export interface SmtpSendOutcome {
  status: "sent" | "failed" | "needs_review" | "pending";
  providerMessageId?: string;
  messageId?: string;
  deliveryOutcome?: SmtpDeliveryOutcome;
  sentCopy?: { state: "complete" | "failed" | "unknown"; folderPath: string };
}
export interface SmtpOutboxArgs {
  accountId: string;
  idempotencyKey: string;
  runtime: ImapConnectionRuntime;
  storage: StorageClient;
  signal: AbortSignal;
}
export interface SmtpAttempt {
  id: string;
  account_id: string;
  status: "pending" | "sending" | "sent" | "failed" | "needs_review";
  message_id_header: string;
  send_started_at: Date | null;
  claimed_at: Date | null;
  claim_token: string | null;
  connection_generation: number | null;
  provider_message_id: string | null;
  delivery_outcome: SmtpReceipt | null;
  payload: SendPayload;
  thread_id: string | null;
  from_email: string;
  owner_id: string;
  sent_at: Date | null;
  message_id: string | null;
  in_reply_to: string | null;
  parent_references: string[] | null;
}
