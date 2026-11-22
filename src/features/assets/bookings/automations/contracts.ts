export const bookingAutomationTriggers = [
  "request_sent_back",
  "return_overdue",
  "pickup_expired",
] as const;

export const bookingAutomationRefreshMs = 30_000;

export type BookingAutomationTrigger = (typeof bookingAutomationTriggers)[number];
export type BookingAutomationState = "pending" | "delivered" | "failed" | "skipped";
export type BookingAutomationOutcome = Exclude<BookingAutomationState, "pending">;
export type BookingAutomationReason =
  | "temporary"
  | "recipient_unavailable"
  | "rule_disabled"
  | "superseded";

export type BookingAutomationNotice = {
  id: string;
  bookingId: string;
  trigger: BookingAutomationTrigger;
  deliveredAt: string;
  dueAt: string | null;
};

export type BookingAutomationAttempt = {
  id: string;
  at: string;
  outcome: BookingAutomationOutcome;
  reason: BookingAutomationReason | null;
};

export type BookingAutomationRun = {
  id: string;
  bookingId: string;
  title: string;
  recipientName: string | null;
  trigger: BookingAutomationTrigger;
  state: BookingAutomationState;
  scheduledAt: string;
  dueAt: string | null;
  attempts: BookingAutomationAttempt[];
  failureId: string | null;
};

export type BookingAutomationProfile = {
  version: number;
  triggers: BookingAutomationTrigger[];
};

export type BookingAutomationRuns = {
  profile: BookingAutomationProfile;
  runs: BookingAutomationRun[];
  nextCursor: string | null;
};

export type BookingAutomationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: "unavailable" | "invalid" | "conflict" };

export type BookingAutomationRunInput = {
  siteId: string;
  status?: BookingAutomationState;
  cursor?: string;
};

export type BookingAutomationProfileInput = {
  requestId: string;
  siteId: string;
  version: number;
  triggers: BookingAutomationTrigger[];
};

export type BookingAutomationRetryInput = {
  requestId: string;
  siteId: string;
  runId: string;
  failureId: string;
};

export type BookingAutomationAccess = {
  readNotices: (
    bookingId: string,
    signal?: AbortSignal,
  ) => Promise<BookingAutomationResult<BookingAutomationNotice[]>>;
  readRuns: (
    input: BookingAutomationRunInput,
    signal?: AbortSignal,
  ) => Promise<BookingAutomationResult<BookingAutomationRuns>>;
  saveProfile: (
    input: BookingAutomationProfileInput,
  ) => Promise<BookingAutomationResult<BookingAutomationProfile>>;
  retry: (
    input: BookingAutomationRetryInput,
  ) => Promise<BookingAutomationResult<BookingAutomationRun>>;
};
