import { useState } from "react";
import { ERROR_IDS } from "@/constants/errorIds";
import { renamePipelineAction } from "./pipelineEditActions";

interface Input {
  pipelineId: string;
  pipelineName: string;
  pipelineUpdatedAt: string;
  snapshotId: string;
  reportError: (id: string) => void;
}
interface Failure {
  id: string;
  snapshotId: string;
}
const REVIEW_REQUIRED = new Set<string>([
  ERROR_IDS.PIPELINE_NOT_FOUND,
  ERROR_IDS.PIPELINE_REVISION_CONFLICT,
  ERROR_IDS.DB_WRITE_FAILED,
  ERROR_IDS.UI_ACTION_UNCONFIRMED,
]);

export function usePipelineRename(input: Input) {
  const [name, setName] = useState(input.pipelineName);
  const [committed, setCommitted] = useState({
    name: input.pipelineName,
    updatedAt: input.pipelineUpdatedAt,
  });
  const [failure, setFailure] = useState<Failure | null>(null);
  const blocked = failure !== null && REVIEW_REQUIRED.has(failure.id);
  const freshRead = failure !== null && input.snapshotId !== failure.snapshotId;

  function fail(id: string): false {
    setFailure({ id, snapshotId: input.snapshotId });
    input.reportError(id);
    return false;
  }

  async function save(csrf: string | null): Promise<boolean> {
    if (blocked) return false;
    if (name === committed.name) return true;
    if (name.trim() === "" || name.length > 255)
      return fail(ERROR_IDS.PIPELINE_RENAME_INPUT_INVALID);
    setFailure(null);
    try {
      const result = await renamePipelineAction(
        { pipelineId: input.pipelineId, name, expectedUpdatedAt: committed.updatedAt },
        csrf,
      );
      if (!result.ok) return fail(result.error.id);
      // A later stage failure must not resubmit a rename that was already acknowledged.
      setCommitted({ name: result.value.name, updatedAt: result.value.updatedAt });
      return true;
    } catch {
      return fail(ERROR_IDS.UI_ACTION_UNCONFIRMED);
    }
  }

  function reviewVersion(): boolean {
    if (!blocked || !freshRead) return false;
    // Keep the authored draft; only explicit review advances its source revision.
    setCommitted({ name: input.pipelineName, updatedAt: input.pipelineUpdatedAt });
    setFailure(null);
    return true;
  }

  return { name, setName, save, blocked, freshRead, failureId: failure?.id ?? null, reviewVersion };
}
