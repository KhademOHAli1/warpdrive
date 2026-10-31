"use client";
import { Button } from "@/components/ui/Button";
import { isTerminalImportStatus } from "@/constants/importStatus";
import { useSettingsMessages } from "@/features/identity/useSettingsMessages";
import { useImportProgress } from "@/features/import/useImportProgress";
import { trpc } from "@/lib/trpc-client";
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
  const batch = trpc.import.getBatch.useQuery(
    { batchId },
    {
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        return status !== undefined && isTerminalImportStatus(status) ? false : POLL_MS;
      },
    },
  ).data;

  const done = batch !== undefined && isTerminalImportStatus(batch.status);
  // The exact imported/skipped/invalid split, computed server-side from row statuses once
  // the commit is terminal (finalizeBatch conflates imported + skipped_duplicate).
  const result = trpc.import.getResult.useQuery({ batchId }, { enabled: done }).data;
  const rows = trpc.import.listRows.useQuery({ batchId }, { enabled: done }).data ?? [];

  if (batch === undefined) {
    return <p className="text-sm text-muted-foreground">{IMP.importing}</p>;
  }

  const counts = result ?? { imported: 0, skipped: 0, invalid: 0 };

  return (
    <section className="space-y-4">
      <h2 className="text-sm font-medium">{statusLabel(batch.status)}</h2>
      {!done && <ProgressBar processed={progress.processed} total={progress.total} />}
      {done && (
        <p className="text-sm tabular-nums text-muted-foreground">
          {IMP.result(counts.imported, counts.skipped, counts.invalid)}
        </p>
      )}
      {done && <RowWarnings rows={rows} />}
      {done && (
        <Button type="button" variant="outline" size="sm" onClick={onReset}>
          {IMP.startOver}
        </Button>
      )}
    </section>
  );
}
