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
import { useSharedBlocksMessages } from "@/features/blocks/sharedBlocksMessages";
import { StudioRecordPicker } from "./StudioRecordPicker";
import { rawValue } from "./studioModel";
import type { WorkflowStudioModel } from "./useWorkflowStudio";
export function StudioLiveDialog({
  model,
  onClose,
}: {
  model: WorkflowStudioModel;
  onClose: () => void;
}) {
  const L = useSharedBlocksMessages();
  const [payload, setPayload] = useState<BlockOutput>({});
  const [requestKey] = useState(() => crypto.randomUUID());
  const config = model.document.draft.trigger.config;
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
          {L.version} {model.document.publishedNumber}
        </p>
        {model.studio !== null &&
          config.availability !== undefined &&
          config.availability !== "global" && (
            <StudioRecordPicker
              node={{
                id: "$trigger",
                type: "FIND_RECORDS",
                version: 1,
                name: L.trigger,
                config: { ...config, ...payload },
              }}
              definition={model.document.draft}
              studio={model.studio}
              disabled={model.pending}
              multiple={config.availability === "bulk"}
              onChange={(next) =>
                setPayload({
                  ...payload,
                  ...(next.recordId === undefined ? {} : { recordId: rawValue(next.recordId) }),
                  ...(next.recordIds === undefined ? {} : { recordIds: rawValue(next.recordIds) }),
                })
              }
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
          <Button
            disabled={model.pending || model.dirty}
            onClick={() => {
              void model.live(payload, requestKey).then((started) => {
                if (started) onClose();
              });
            }}
          >
            {model.pending ? L.working : L.runConfirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
