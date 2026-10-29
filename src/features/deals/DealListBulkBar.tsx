"use client";
import { useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/Button";
import { Select, type SelectOption } from "@/components/ui/Select";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";

interface BulkBarStage {
  id: string;
  name: string;
}

interface DealListBulkBarProps {
  count: number;
  stages: BulkBarStage[];
  onConfirmStage: (toStageId: string) => Promise<void>;
  onConfirmArchive?: () => Promise<void>;
}

export function DealListBulkBar(props: DealListBulkBarProps): React.ReactNode {
  const translateSales = useAppTranslations("sales");

  const { count, stages, onConfirmStage, onConfirmArchive } = props;
  const [pendingStageId, setPendingStageId] = useState<string | null>(null);
  const [archivePending, setArchivePending] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const stageName = (id: string): string => stages.find((s) => s.id === id)?.name ?? "";

  return (
    <>
      <div
        role="toolbar"
        aria-label={translateSales("bulk_actions_19f0d")}
        className="flex items-center gap-3 border-b bg-accent px-4 py-2"
      >
        <span className="text-sm font-medium tabular-nums text-accent-foreground">
          {translateSales("computed.selectedCount", { count })}
        </span>
        <Select
          ariaLabel={translateSales("move_to_stage_e64cc")}
          value=""
          onChange={(v) => setPendingStageId(v === "" ? null : v)}
          placeholder={translateSales("move_to_stage_a28cf")}
          options={stages.map<SelectOption>((s) => ({ value: s.id, label: s.name }))}
        />
        {onConfirmArchive ? (
          <Button
            variant="outline"
            size="sm"
            disabled={archiving}
            onClick={() => setArchivePending(true)}
          >
            {translateSales("archive_66f48")}
          </Button>
        ) : null}
      </div>

      {pendingStageId !== null && (
        <ConfirmDialog
          open
          onOpenChange={(next) => {
            if (!next) setPendingStageId(null);
          }}
          title={translateSales("computed.moveDealsTitle", {
            count,
            stageName: stageName(pendingStageId),
          })}
          description={translateSales("computed.moveDealsBody")}
          confirmLabel={translateSales("move_deals_7de8c")}
          onConfirm={() => {
            const toStageId = pendingStageId;
            setPendingStageId(null);
            void onConfirmStage(toStageId);
          }}
        />
      )}

      {archivePending && onConfirmArchive ? (
        <ConfirmDialog
          open
          onOpenChange={(next) => {
            if (!next) setArchivePending(false);
          }}
          title={translateSales("computed.archiveDealsTitle", { count })}
          description={translateSales("computed.archiveDealsBody")}
          confirmLabel={translateSales("archive_deals_7560b")}
          onConfirm={() => {
            setArchivePending(false);
            setArchiving(true);
            void onConfirmArchive().finally(() => setArchiving(false));
          }}
        />
      ) : null}
    </>
  );
}
