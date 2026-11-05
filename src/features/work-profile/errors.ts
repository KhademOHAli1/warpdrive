import { ERROR_IDS } from "@/constants/errorIds";
import { err, ok, type Result } from "@/types/result";
import type { WorkError, WorkErrorCode } from "./contracts";
export class WorkRollback extends Error {
  constructor(readonly code: WorkErrorCode) {
    super(code);
    this.name = "WorkRollback";
  }
}
export function fail(code: WorkErrorCode): never {
  throw new WorkRollback(code);
}
const ids: Partial<Record<WorkErrorCode, string>> = {
  forbidden: ERROR_IDS.WORK_DENIED,
  invalid_input: ERROR_IDS.WORK_INPUT_INVALID,
  conflict: ERROR_IDS.WORK_CONFLICT,
  not_found: ERROR_IDS.WORK_NOT_FOUND,
  preview_stale: ERROR_IDS.WORK_PREVIEW_STALE,
  replay_conflict: ERROR_IDS.WORK_REPLAY_CONFLICT,
  in_use: ERROR_IDS.WORK_IN_USE,
  unavailable: ERROR_IDS.WORK_WRITE_FAILED,
};
export async function operational<T>(
  signal: AbortSignal,
  run: () => Promise<T>,
): Promise<Result<T, WorkError>> {
  try {
    signal.throwIfAborted();
    return ok(await run());
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof WorkRollback) return err({ code: error.code, id: ids[error.code] });
    return err({ code: "unavailable", id: ERROR_IDS.WORK_WRITE_FAILED });
  }
}
