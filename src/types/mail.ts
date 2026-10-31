export interface SendEmailOutcome {
  attemptId?: string;
  status: string;
  messageId?: string;
  providerMessageId?: string;
  deliveryOutcome?: {
    state: "accepted" | "partial" | "unknown" | "rejected";
    accepted?: string[];
    rejected?: string[];
  };
  sentCopy?: { state: "complete" | "failed" | "unknown"; folderPath: string };
}
