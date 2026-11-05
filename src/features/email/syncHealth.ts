import { SYNC_STALL_SECONDS } from "@/constants/email";
import type { MailboxConnectionError } from "./connections/types";

export type MailboxSyncHealth = "syncing" | "stalled" | "disconnected";

export interface MailboxSyncRow {
  status: string;
  lastSyncAtIso: string | null;
}

export type GmailMailboxDisplayHealth = MailboxSyncHealth | "paused" | "authorization-failed";

export interface GmailMailboxHealthRow extends MailboxSyncRow {
  paused?: boolean;
  errorCode?: MailboxConnectionError;
}

export function gmailMailboxDisplayHealth(
  row: GmailMailboxHealthRow | null,
  now: Date | null,
): GmailMailboxDisplayHealth {
  if (row === null) return "disconnected";
  if (row.status !== "disconnected" && (row.status === "paused" || row.paused === true))
    return "paused";
  if (row.errorCode === "authentication") return "authorization-failed";
  if (row.status === "disconnected") return "disconnected";
  if (row.status === "error") return "stalled";
  return now === null ? "syncing" : mailboxSyncHealth(row, now);
}

export function mailboxSyncHealth(row: MailboxSyncRow, now: Date): MailboxSyncHealth {
  if (row.status === "disconnected") return "disconnected";
  if (row.status === "error") return "stalled";
  if (row.lastSyncAtIso === null) return "syncing";
  const ageSeconds = (now.getTime() - new Date(row.lastSyncAtIso).getTime()) / 1000;
  return ageSeconds >= SYNC_STALL_SECONDS ? "stalled" : "syncing";
}
