export type DeliveryReportMediaType = "message/delivery-status" | "message/global-delivery-status";
export type DeliveryReportProvenance = "direct" | "nested" | "forwarded";
export type DeliveryReportAction = "failed" | "delayed" | "delivered" | "relayed" | "expanded";

export interface DeliveryReportInput {
  // Transfer decoding and MIME-container validation belong to the receiving adapter.
  content: Uint8Array;
  mediaType: DeliveryReportMediaType;
  provenance: DeliveryReportProvenance;
}

export interface DeliveryReportField {
  name: string;
  value: string;
}

export interface DeliveryReportTypedValue {
  type: string;
  // Opaque wire value: no mailbox normalization, alias matching or unitext guessing.
  value: string;
}

export interface DeliveryReportDiagnostic {
  type: string;
  text: string;
  display: "plain_text";
}

export interface DeliveryReportRecipient {
  originalRecipient: DeliveryReportTypedValue | null;
  finalRecipient: DeliveryReportTypedValue;
  action: DeliveryReportAction;
  status: string;
  statusClass: 2 | 4 | 5;
  terminalReport: boolean;
  actionStatus: "consistent" | "conflict";
  remoteMta: DeliveryReportTypedValue | null;
  diagnostic: DeliveryReportDiagnostic | null;
  localizedDiagnostics: { languageTag: string; text: string; display: "plain_text" }[];
  lastAttemptDate: string | null;
  finalLogId: string | null;
  willRetryUntil: string | null;
  extensions: DeliveryReportField[];
}

export interface ParsedDeliveryReport {
  mediaType: DeliveryReportMediaType;
  provenance: DeliveryReportProvenance;
  trust: "unverified";
  requiresReview: true;
  correlationAuthority: false;
  reportingMta: DeliveryReportTypedValue;
  originalEnvelopeId: string | null;
  dsnGateway: DeliveryReportTypedValue | null;
  receivedFromMta: DeliveryReportTypedValue | null;
  arrivalDate: string | null;
  extensions: DeliveryReportField[];
  recipients: DeliveryReportRecipient[];
}

export type DeliveryReportFailure = {
  code:
    | "invalid_input"
    | "unsupported_media_type"
    | "invalid_utf8"
    | "non_ascii_dsn"
    | "limit_exceeded"
    | "invalid_line_endings"
    | "malformed_field"
    | "missing_field"
    | "duplicate_field"
    | "invalid_action"
    | "invalid_status"
    | "invalid_diagnostic";
};

export const DELIVERY_REPORT_LIMITS = {
  messageBytes: 128 * 1024,
  recipientBlocks: 100,
  fieldsPerBlock: 64,
  lineBytes: 4096,
  fieldBytes: 8192,
  diagnosticBytes: 2048,
  localizedDiagnostics: 8,
  commentDepth: 16,
} as const;
