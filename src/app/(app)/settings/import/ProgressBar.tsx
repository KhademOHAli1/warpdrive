"use client";

import { Progress } from "@/components/ui/Progress";
import { useSettingsMessages } from "@/features/identity/useSettingsMessages";

export function ProgressBar({
  processed,
  total,
}: {
  processed: number;
  total: number;
}): React.ReactNode {
  const L = useSettingsMessages();

  const pct = total > 0 ? Math.min(Math.round((processed / total) * 100), 100) : 0;
  return (
    <div className="space-y-1">
      <Progress
        value={pct}
        label={L._extra.import_progress}
        aria-valuetext={L._extra.progressText(processed, total, pct)}
      />
      <p className="text-xs tabular-nums text-muted-foreground">
        {L._extra.progressText(processed, total, pct)}
      </p>
    </div>
  );
}
