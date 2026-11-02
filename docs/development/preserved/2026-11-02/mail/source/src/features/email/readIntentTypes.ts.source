import type { ErrorId } from "@/constants/errorIds";

export type ReadIntentState =
  | "prepared"
  | "admitted"
  | "applied"
  | "denied"
  | "cancelled"
  | "unknown";

export interface ReadIntentReceipt {
  operationId: string;
  threadId: string;
  desiredRead: boolean;
  state: ReadIntentState;
  admitBefore: string;
  errorId?: ErrorId;
}

export interface ReadActionValue {
  threadId: string;
  readIntent?: ReadIntentReceipt;
}

export interface ReadIntentPreparation {
  kind: "created" | "blocked";
  readIntent: ReadIntentReceipt;
}

export interface ReadIntentBinding {
  actorId: string;
  accountId: string;
  threadId: string;
  mailboxOwnerId: string;
  accountProvider: "gmail" | "imap_smtp" | "microsoft";
  connectionGeneration: number;
  privateCopy: boolean;
  desiredRead: boolean;
  readMode: "local" | "imap";
}

export interface StoredReadIntent extends ReadIntentBinding {
  operationId: string;
  state: ReadIntentState;
  createdAt: string | Date;
  admitBefore: string | Date;
  admittedAt: string | Date | null;
  terminalAt: string | Date | null;
  dispatchClaim: string | null;
  errorId: ErrorId | null;
}
