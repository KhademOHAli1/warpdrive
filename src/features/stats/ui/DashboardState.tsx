import { ChartNoAxesCombined, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useStatsMessages } from "../useStatsMessages";

export function DashboardError({ onRetry, retrying }: { onRetry: () => void; retrying: boolean }) {
  const S = useStatsMessages();
  return (
    <div
      role="alert"
      className="flex flex-col items-center rounded-xl border bg-card px-6 py-16 text-center"
    >
      <span className="mb-4 rounded-xl bg-muted p-4">
        <ChartNoAxesCombined aria-hidden="true" className="size-6 text-muted-foreground" />
      </span>
      <h2 className="text-balance text-lg font-semibold">{S.statsUnavailable}</h2>
      <p className="mt-2 max-w-md text-pretty text-sm leading-relaxed text-muted-foreground">
        {S.retryExplanation}
      </p>
      <Button variant="outline" className="mt-5" onClick={onRetry} disabled={retrying}>
        <RefreshCw aria-hidden="true" className="size-4" />
        {retrying ? S.loading : S.retry}
      </Button>
    </div>
  );
}
