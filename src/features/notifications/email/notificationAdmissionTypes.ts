export const NOTIFICATION_SUPPRESSION_REASONS = [
  "preference_disabled",
  "entity_unavailable",
  "recipient_unavailable",
  "notification_unavailable",
  "purpose_invalid",
] as const;

export type NotificationSuppressionReason = (typeof NOTIFICATION_SUPPRESSION_REASONS)[number];

export type NotificationAdmissionState =
  | "ordinary"
  | "admitted"
  | "deferred"
  | "suppressed"
  | "retained"
  | "missing";

export interface NotificationAdmissionArgs {
  accountId: string;
  attemptId: string;
  signal: AbortSignal;
}

export interface NotificationAdmissionPointer {
  id: string;
  owner_id: string;
  payload: unknown;
}

export interface NotificationAdmissionAuthority {
  ownerId: string;
  active: boolean;
  invited: boolean;
  connected: boolean;
  sendCapable: boolean;
}

export interface NotificationAdmissionAttempt {
  id: string;
  idempotency_key: string;
  payload: unknown;
  unsubmitted: boolean;
  suppressed: boolean;
}

export type NotificationAdmissionPolicy =
  | { state: "admitted" | "deferred" }
  | { state: "suppressed"; reason: NotificationSuppressionReason };
