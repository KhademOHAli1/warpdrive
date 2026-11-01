import type { Result } from "@/types/result";
import type {
  DeliveryReportMediaType,
  DeliveryReportProvenance,
  DeliveryReportRecipient,
} from "./deliveryReportTypes";

export type DeliveryObservationError =
  | "invalid_input"
  | "not_found"
  | "conflict"
  | "permission"
  | "rate_limit"
  | "unknown";

export interface DeliveryReviewTarget {
  attemptId: string;
  subject: string;
  sentAt: string;
  recipients: { address: string; kind: "to" | "cc" | "bcc" }[];
}

export interface DeliveryReviewState {
  revision: number;
  decision: "unreviewed" | "associated" | "dismissed" | "unavailable";
  target: { attemptId: string; recipient: string; kind: "to" | "cc" | "bcc" } | null;
}

export interface DeliveryRecipientView extends DeliveryReportRecipient {
  index: number;
  review: DeliveryReviewState;
}

// Owner-only projection, never permission to mutate submission or delivery facts.
export interface DeliveryObservationView {
  id: string;
  sourceMessageId: string;
  partKey: string;
  mediaType: DeliveryReportMediaType;
  provenance: DeliveryReportProvenance;
  trust: "unverified";
  requiresReview: true;
  recipients: DeliveryRecipientView[];
}

interface DeliveryReviewBase {
  reportId: string;
  recipientIndex: number;
  expectedRevision: number;
  confirmUnverified: true;
}

export type DeliveryReviewInput = DeliveryReviewBase &
  (
    | { decision: "associate"; target: { attemptId: string; recipient: string } }
    | { decision: "dismiss" }
  );

export interface DeliveryReportsPanelProps {
  isOwner: boolean;
  reports: DeliveryObservationView[];
  targets: DeliveryReviewTarget[];
  // Server commits must compare expectedRevision atomically. A client flag grants no authority.
  onReview: (
    input: DeliveryReviewInput,
  ) => Promise<Result<DeliveryReviewState, DeliveryObservationError>>;
}

// Wiring contract: preserve this subtree across dialog close/reopen. Permission/conflict
// lockout clears only for a newly read canonical revision. To retry the same revision,
// complete an authenticated parent fresh read first, then deliberately remount the panel;
// do not key it by dialog visibility or ordinary render/object identity.
