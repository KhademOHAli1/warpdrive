import type { Result } from "@/types/result";
import type { PrivacyArchiveFailure, PrivacyArchiveReceipt } from "./exportArchiveTypes";
import type {
  ExportAttemptRef,
  ExportStoredObject,
  ExportStoreFailure,
  ExportUploadRef,
} from "./exportObjectStoreTypes";

export interface PrivacyArchiveStageRepair {
  readonly attempt: ExportAttemptRef;
  readonly upload: ExportUploadRef | null;
}

export type PrivacyArchiveStageFailure =
  | {
      phase: "preflight";
      code: PrivacyArchiveFailure | "invalid_object_ref";
      repair: null;
    }
  | {
      phase: "begin" | "complete";
      code: ExportStoreFailure;
      repair: PrivacyArchiveStageRepair;
    }
  | {
      phase: "archive";
      code: PrivacyArchiveFailure;
      repair: PrivacyArchiveStageRepair;
    };

export type PrivacyArchiveStageResult = Result<
  { object: ExportStoredObject; receipt: PrivacyArchiveReceipt },
  PrivacyArchiveStageFailure
>;
