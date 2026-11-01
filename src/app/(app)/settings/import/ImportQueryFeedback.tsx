"use client";

import { Button } from "@/components/ui/Button";
import { useSettingsMessages } from "@/features/identity/useSettingsMessages";

export function ImportQueryFeedback({
  loadingLabel,
  failed,
  retrying = false,
  onRetry,
}: {
  loadingLabel: string;
  failed: boolean;
  retrying?: boolean;
  onRetry: () => void;
}) {
  const J = useSettingsMessages()._extra.importJourney;
  if (!failed)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {loadingLabel}
      </p>
    );
  return (
    <div
      role="alert"
      className="space-y-3 rounded-md border border-destructive/30 bg-destructive/5 p-4"
    >
      <p className="text-sm text-destructive">{J.loadFailed}</p>
      <Button variant="outline" size="sm" disabled={retrying} onClick={onRetry}>
        {J.retry}
      </Button>
    </div>
  );
}
