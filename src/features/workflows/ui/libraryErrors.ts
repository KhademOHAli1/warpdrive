import { ERROR_IDS } from "@/constants/errorIds";

export type LibraryWriteError =
  | "denied"
  | "conflict"
  | "lifecycleInvalid"
  | "copyUnavailable"
  | "error"
  | "writeUnknown";

export function libraryWriteError(code: string, reason?: unknown): LibraryWriteError {
  if (code === ERROR_IDS.WORKFLOW_DENIED) return "denied";
  if (code === ERROR_IDS.WORKFLOW_CONFLICT) return "conflict";
  if (code === ERROR_IDS.WORKFLOW_INVALID) return "lifecycleInvalid";
  if (code === ERROR_IDS.WORKFLOW_NOT_READY && reason === "copy-unavailable")
    return "copyUnavailable";
  return "error";
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function readCode(error: unknown) {
  if (!record(error)) return { code: undefined, message: undefined };
  return { code: record(error.data) ? error.data.code : undefined, message: error.message };
}

export function libraryReadDenied(error: unknown): boolean {
  const { code, message } = readCode(error);
  return code === "FORBIDDEN" || code === "UNAUTHORIZED" || message === ERROR_IDS.WORKFLOW_DENIED;
}

export function libraryReadInvalid(error: unknown): boolean {
  const { code, message } = readCode(error);
  return code === "BAD_REQUEST" || message === ERROR_IDS.WORKFLOW_INVALID;
}

export function libraryRefetchFailed(result: unknown): boolean {
  return record(result) && result.isError === true;
}

export function libraryRefetchHasData(result: unknown): boolean {
  return record(result) && result.data !== undefined;
}
