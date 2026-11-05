import { ChartNoAxesCombined, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import { useStatsMessages } from "../useStatsMessages";

export function DashboardLoading() {
  const S = useStatsMessages();
  return (
    <div role="status" aria-label={S.loading} className="space-y-5">
      <span className="sr-only">{S.loading}</span>
      <div
        aria-hidden="true"
        className="grid grid-cols-2 gap-6 rounded-xl border bg-card p-5 xl:grid-cols-5"
      >
        {[0, 1, 2, 3, 4].map((key) => (
          <div key={key} className={cn("h-28", key === 0 && "col-span-2 xl:col-span-1")}>
            <div className="h-3 w-2/3 rounded bg-muted" />
            <div className="mt-6 h-7 w-1/2 rounded bg-muted" />
          </div>
        ))}
      </div>
      <div aria-hidden="true" className="h-80 rounded-xl border bg-card" />
    </div>
  );
}

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
