"use client";
import { Button } from "@/components/ui/Button";
import { isTerminalImportStatus } from "@/constants/importStatus";
import { useSettingsMessages } from "@/features/identity/useSettingsMessages";
import { useImportProgress } from "@/features/import/useImportProgress";
import { trpc } from "@/lib/trpc-client";
import { ImportQueryFeedback } from "./ImportQueryFeedback";
import { ProgressBar } from "./ProgressBar";
import { RowWarnings } from "./RowWarnings";

// Poll every second until the batch reaches a terminal status, then stop.
const POLL_MS = 1000;

export interface CommitStepProps {
  batchId: string;
  onReset: () => void;
}

export function CommitStep({ batchId, onReset }: CommitStepProps): React.ReactNode {
  const L = useSettingsMessages();
  const IMP = L.importer;
  function statusLabel(status: string): string {
    if (status === "completed") return IMP.statusCompleted;
    if (status === "partial") return IMP.statusPartial;
    if (status === "failed") return IMP.statusFailed;
    return IMP.importing;
  }

  const progress = useImportProgress(batchId);
  const batchQuery = trpc.import.getBatch.useQuery(
    { batchId },
    {
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        return status !== undefined && isTerminalImportStatus(status) ? false : POLL_MS;
      },
    },
  );
  const batch = batchQuery.data;

  const done = batch !== undefined && isTerminalImportStatus(batch.status);
  // The exact imported/skipped/invalid split, computed server-side from row statuses once
  // the commit is terminal (finalizeBatch conflates imported + skipped_duplicate).
  const resultQuery = trpc.import.getResult.useQuery({ batchId }, { enabled: done });
  const rowsQuery = trpc.import.listRows.useQuery({ batchId }, { enabled: done });
  const result = resultQuery.data;

  if (batch === undefined) {
    return (
      <ImportQueryFeedback
        loadingLabel={IMP.importing}
        failed={batchQuery.isError}
        retrying={batchQuery.isFetching}
        onRetry={() => void batchQuery.refetch()}
      />
    );
  }

  return (
    <section className="space-y-4">
      <h2 className="text-sm font-medium">{statusLabel(batch.status)}</h2>
      {!done && <ProgressBar processed={progress.processed} total={progress.total} />}
      {batchQuery.isError && (
        <ImportQueryFeedback
          loadingLabel={IMP.importing}
          failed
          retrying={batchQuery.isFetching}
          onRetry={() => void batchQuery.refetch()}
        />
      )}
      {done && (result === undefined || resultQuery.isError) && (
        <ImportQueryFeedback
          loadingLabel={L._extra.importJourney.loadingResult}
          failed={resultQuery.isError}
          retrying={resultQuery.isFetching}
          onRetry={() => void resultQuery.refetch()}
        />
      )}
      {done && result !== undefined && (
        <p className="text-sm tabular-nums text-muted-foreground">
          {IMP.result(result.imported, result.skipped, result.invalid)}
        </p>
      )}
      {done && (rowsQuery.data === undefined || rowsQuery.isError) && (
        <ImportQueryFeedback
          loadingLabel={L._extra.importJourney.loadingRows}
          failed={rowsQuery.isError}
          retrying={rowsQuery.isFetching}
          onRetry={() => void rowsQuery.refetch()}
        />
      )}
      {done && rowsQuery.data !== undefined && <RowWarnings rows={rowsQuery.data} />}
      {done && (
        <Button type="button" variant="outline" size="sm" onClick={onReset}>
          {IMP.startOver}
        </Button>
      )}
    </section>
  );
}
