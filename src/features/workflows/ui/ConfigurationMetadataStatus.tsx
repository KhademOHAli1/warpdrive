"use client";
import { Button } from "@/components/ui/Button";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import type { WorkflowConfigurationRead } from "./useWorkflowConfiguration";

const keys = {
  denied: "configurationMetadataDenied",
  error: "configurationMetadataError",
  stale: "configurationMetadataStale",
  loading: "configurationMetadataIncomplete",
  incomplete: "configurationMetadataIncomplete",
} as const;
export function ConfigurationMetadataStatus({ read }: { read: WorkflowConfigurationRead }) {
  const t = useAppTranslations("workflows");
  const status = read.metadata.status;
  if (status === "complete") return null;
  const retry = status === "error" || status === "stale";
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">{t(keys[status])}</p>
      {read.loadMore !== undefined && (
        <Button
          type="button"
          variant="outline"
          disabled={read.busy}
          onClick={() => {
            void read.loadMore?.();
          }}
        >
          {t("configurationLoadMore")}
        </Button>
      )}
      {retry && (
        <Button
          type="button"
          variant="outline"
          disabled={read.busy}
          onClick={() => {
            void read.retry();
          }}
        >
          {t("retry")}
        </Button>
      )}
    </div>
  );
}
