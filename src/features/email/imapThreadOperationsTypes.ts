import type { AppError } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import type { Result } from "@/types/result";
import type { ImapConnectionRuntime } from "./mailConnectionRuntime";
import type { ImapFailure } from "./providers/imapTypes";

export type ImapThreadOperation =
  | { kind: "read"; read: boolean }
  | { kind: "move"; destinationPath: string }
  | { kind: "trash" };
export interface ImapThreadOperationDeps {
  loadConnection?: (
    db: Db,
    accountId: string,
    signal: AbortSignal,
  ) => Promise<Result<ImapConnectionRuntime, AppError>>;
}
export interface ImapOperationLocator {
  id: string;
  folderId: string;
  path: string;
  uidValidity: string;
  uid: number;
  messageId: string;
  flags: string[];
}
export interface ImapConfirmedLocator {
  locator: ImapOperationLocator;
  flags: string[];
  active: boolean;
}
export interface ImapNetworkOutcome {
  confirmed: ImapConfirmedLocator[];
  failure: ImapFailure | null;
  movedCopies?: ImapMovedCopy[];
  trash?: boolean;
  requiresResync?: boolean;
}

export interface ImapMovedCopy {
  locator: ImapOperationLocator;
  path: string;
  uidValidity: string;
  uid: number;
  flags: string[];
  active: boolean;
}
export const IMAP_THREAD_MAX_LOCATORS = 1000;
