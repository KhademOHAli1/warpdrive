import { AppError, ERROR_IDS } from "@/constants/errorIds";

export function nativeError(reason: string): AppError {
  return new AppError(ERROR_IDS.WORKFLOW_INVALID, reason);
}
