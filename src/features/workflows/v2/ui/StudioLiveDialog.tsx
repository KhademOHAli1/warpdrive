"use client";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { BlockOutput } from "@/features/blocks/contracts";
import { useFormatters } from "@/lib/useFormatters";
import { StudioRecordOptions } from "./StudioRecordPicker";
import type { WorkflowStudioModel } from "./useWorkflowStudio";

export function StudioLiveDialog({
  launch,
  model,
  onClose,
}: {
  launch: NonNullable<WorkflowStudioModel["manualLaunch"]>;
  model: WorkflowStudioModel;
  onClose: () => void;
}) {
  const { L } = model;
  const format = useFormatters();
  const [records, setRecords] = useState<string[]>([]);
  const [requestKey] = useState(() => crypto.randomUUID());
  const recordId = records[0];
  const canLaunch = launch.availability === "global" || recordId !== undefined;
  function chooseRecord(id: string) {
    setRecords((current) => {
      if (launch.availability === "single") return [id];
      return current.includes(id) ? current.filter((record) => record !== id) : [...current, id];
    });
  }
  function start() {
    if (!canLaunch) return;
    const trigger: BlockOutput =
      launch.availability === "bulk"
        ? { recordIds: records }
        : launch.availability === "single" && recordId !== undefined
          ? { recordId }
          : {};
    void model.live(trigger, requestKey, launch.version).then((started) => {
      if (started) onClose();
    });
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !model.pending) onClose();
      }}
    >
      <DialogContent
        onPointerDownOutside={(event) => {
          if (model.pending) event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          if (model.pending) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>{L.run}</DialogTitle>
          <DialogDescription>{L.liveHint}</DialogDescription>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          {L.version} {format.number(launch.version)}
        </p>
        {launch.availability !== "global" && (
          <StudioRecordOptions
            objectName={launch.objectName}
            selected={records}
            disabled={model.pending}
            selectionLimit={launch.availability === "bulk" ? 100 : undefined}
            onChoose={chooseRecord}
          />
        )}
        {model.error !== null && (
          <p role="alert" className="text-xs text-destructive">
            {model.error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={model.pending} onClick={onClose}>
            {L.cancel}
          </Button>
          <Button disabled={model.pending || !canLaunch} onClick={start}>
            {model.pending ? L.working : L.runConfirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
