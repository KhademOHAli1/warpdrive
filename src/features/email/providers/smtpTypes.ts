import type { ApprovedEndpoint } from "@/features/connections/connectionEndpoint";

export interface SmtpTimeouts {
  connectionMs: number;
  greetingMs: number;
  socketMs: number;
}

export const SMTP_TIMEOUTS: Readonly<SmtpTimeouts> = {
  connectionMs: 30_000,
  greetingMs: 15_000,
  socketMs: 30_000,
};

export interface SmtpTransportConfig {
  endpoint: ApprovedEndpoint;
  username: string;
  password: string;
  timeouts?: Partial<SmtpTimeouts>;
}

export interface SmtpSubmission {
  accepted: string[];
  rejected: string[];
  partial: boolean;
  responseCode: number;
  messageId: string | null;
  serverMessageId: string | null;
}

export type SmtpFailure = {
  kind:
    | "invalid_request"
    | "authentication"
    | "tls"
    | "connection"
    | "timeout"
    | "submission_rejected"
    | "submission_unknown"
    | "smtp_utf8_unsupported"
    | "connection_changed";
  // Certainty that no message was accepted, not permission for automatic backoff/retry.
  retrySafe: boolean;
  responseCode?: number;
};

export interface SmtpRawSubmission {
  from: string;
  to: string[];
  raw: Buffer | string;
  signal: AbortSignal;
  beforeSubmission?: (signal: AbortSignal) => Promise<boolean>;
}
