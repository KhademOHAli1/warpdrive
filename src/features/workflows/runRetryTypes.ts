export type RunRetryReason =
  | "available"
  | "notFailed"
  | "legacy"
  | "actor"
  | "permission"
  | "paused"
  | "unsupported"
  | "repair"
  | "inconsistent";

export interface RunFailureHistory {
  id: string;
  nodeId: string | null;
  errorId: string;
  failedAt: Date;
  origin: "recorded" | "legacy_snapshot";
  originalResumeAt: Date | null;
  retriedAt: Date | null;
}

export interface RunRecovery {
  eligible: boolean;
  failureId: string | null;
  reason: RunRetryReason;
  history: RunFailureHistory[];
}

// An internal reference established by the native cookie credential check. It
// cannot be supplied in a serialized retry command and is not authentication.
export interface RetrySessionRef {
  userId: string;
  sessionId: string;
}
