import type { RunRecovery } from "./runRetryTypes";

export const RUN_HISTORY_PAGE_SIZE = 50;
export const historyStatusFilters = [
  "all",
  "queued",
  "running",
  "waiting",
  "succeeded",
  "failed",
  "cancelled",
] as const;
export const historyModeFilters = ["all", "live", "simulation"] as const;
export type HistoryStatusFilter = (typeof historyStatusFilters)[number];
export type HistoryModeFilter = (typeof historyModeFilters)[number];
export type HistoryRunStatus = Exclude<HistoryStatusFilter, "all">;
export type HistoryRunMode = Exclude<HistoryModeFilter, "all">;

export interface RunHistoryItem {
  id: string;
  status: HistoryRunStatus;
  mode: HistoryRunMode;
  resumeAt: Date | null;
  versionId: string;
  errorId: string | null;
  createdAt: Date;
  updatedAt: Date;
  steps: { nodeId: string; simulated: boolean; completedAt: Date }[];
  recovery?: RunRecovery;
}

export interface RunHistoryPage {
  items: RunHistoryItem[];
  nextCursor: string | null;
}
