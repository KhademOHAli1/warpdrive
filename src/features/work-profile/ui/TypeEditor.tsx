"use client";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCompanyMessages } from "@/features/company-profile/messages";
import { CommandFeedback } from "@/features/company-profile/ui/CommandFeedback";
import { PRIVATE, TextField } from "@/features/company-profile/ui/Fields";
import { rebaseDraft } from "@/features/company-profile/ui/rebaseDraft";
import {
  useDepartureGuard,
  useDraftDismissal,
} from "@/features/company-profile/ui/useDepartureGuard";
import { useProfileCommand } from "@/features/company-profile/ui/useProfileApi";
import { commandSchema, type StageDraft, type WorkType, workTypeSchema } from "../contracts";
import { useWorkMessages } from "../messages";
import { TypeFields } from "./TypeFields";
import { TypeStages } from "./TypeStages";
export function TypeEditor({
  type,
  latest,
  reload,
  actorId,
  close,
  changed,
}: {
  type: WorkType | null;
  latest: WorkType | null;
  reload: () => void;
  actorId: string;
  close: () => void;
  changed: (type: WorkType) => void;
}) {
  const c = useCompanyMessages();
  const m = useWorkMessages();
  const initial = {
    name: type?.name ?? "",
    fields: type?.fields ?? [],
    stages:
      type?.stages
        .filter((stage) => !stage.isArchived)
        .map(({ key, name, bucket }) => ({ key, name, bucket })) ??
      ([
        { key: "open", name: m.open, bucket: "open" },
        { key: "complete", name: m.complete, bucket: "complete" },
        { key: "canceled", name: m.canceled, bucket: "canceled" },
      ] as StageDraft[]),
  };
  const [draft, setDraft] = useState(initial);
  const [baseline, setBaseline] = useState(initial);
  const [record, setRecord] = useState(type);
  const command = useProfileCommand(
    `work:${actorId}:type:${type?.id ?? "new"}`,
    commandSchema,
    workTypeSchema,
    "/api/work-profile",
  );
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  useDepartureGuard(dirty || command.command !== null, c.unsaved);
  const locked = command.busy || command.command !== null;
  const accept = (value: WorkType | null) => {
    if (value) {
      setRecord(value);
      setBaseline(draft);
      changed(value);
    }
  };
  const { dismiss, confirmation } = useDraftDismissal(dirty, locked, close);
  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) dismiss();
        }}
      >
        <DialogContent className={`${PRIVATE} max-h-[90dvh] overflow-y-auto sm:max-w-3xl`}>
          <DialogHeader>
            <DialogTitle>{record ? m.configuration : m.newType}</DialogTitle>
            <DialogDescription>{m.configHint}</DialogDescription>
          </DialogHeader>
          <TextField
            label={c.name}
            value={draft.name}
            maxLength={120}
            disabled={locked}
            onChange={(name) => setDraft({ ...draft, name })}
          />
          <TypeStages
            value={draft.stages}
            disabled={locked}
            onChange={(stages) => setDraft({ ...draft, stages })}
          />
          <TypeFields
            value={draft.fields}
            disabled={locked}
            onChange={(fields) => setDraft({ ...draft, fields })}
          />
          {latest && record && latest.revision > record.revision ? (
            <div className="space-y-2">
              <p className="text-sm">{c.errorConflict}</p>
              <Button
                variant="outline"
                disabled={locked}
                onClick={() => {
                  const current = {
                    name: latest.name,
                    fields: latest.fields,
                    stages: latest.stages
                      .filter((stage) => !stage.isArchived)
                      .map(({ key, name, bucket }) => ({ key, name, bucket })),
                  };
                  setDraft(rebaseDraft(baseline, draft, current));
                  setBaseline(current);
                  setRecord(latest);
                }}
              >
                {c.review}
              </Button>
            </div>
          ) : null}
          <CommandFeedback
            state={command}
            retry={() => {
              void command.retry().then(accept);
            }}
            discard={command.discard}
            cancel={() => {
              void command.cancel().then(accept);
            }}
          />
          <div className="flex justify-end gap-2">
            {record ? (
              <Button variant="outline" disabled={command.busy} onClick={reload}>
                {c.refresh}
              </Button>
            ) : null}
            <Button variant="outline" disabled={locked} onClick={dismiss}>
              {c.cancel}
            </Button>
            <Button
              disabled={locked || !dirty}
              onClick={() => {
                void command
                  .run({
                    action: "configure_type",
                    requestId: crypto.randomUUID(),
                    ...(record ? { id: record.id } : {}),
                    expectedRevision: record?.revision ?? 0,
                    name: draft.name,
                    kind: record?.kind ?? "custom",
                    stages: draft.stages,
                    fields: draft.fields,
                  })
                  .then(accept);
              }}
            >
              {command.busy ? c.saving : c.save}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {confirmation}
    </>
  );
}
