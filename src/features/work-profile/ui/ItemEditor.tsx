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
import { CommandFeedback, ProfileError } from "@/features/company-profile/ui/CommandFeedback";
import { PRIVATE } from "@/features/company-profile/ui/Fields";
import { rebaseDraft } from "@/features/company-profile/ui/rebaseDraft";
import {
  useDepartureGuard,
  useDraftDismissal,
} from "@/features/company-profile/ui/useDepartureGuard";
import { useProfileCommand, useProfileResource } from "@/features/company-profile/ui/useProfileApi";
import {
  commandSchema,
  type ItemDraft,
  itemDraftSchema,
  type WorkItem,
  type WorkOptions,
  type WorkType,
  workItemSchema,
} from "../contracts";
import { useWorkMessages } from "../messages";
import { ItemFields } from "./ItemFields";
export function draftForItem(item: WorkItem): ItemDraft {
  return {
    typeId: item.typeId,
    stageId: item.stageId,
    title: item.title,
    description: item.description,
    ownerId: item.ownerId,
    organizationId: item.organizationId,
    personId: item.personId,
    dealId: item.dealId,
    dueDate: item.dueDate,
    visibility: item.visibility,
    visibilityGroupId: item.visibilityGroupId,
    values: item.values,
  };
}
export function ItemEditor({
  item,
  types,
  options,
  actorId,
  typeId,
  scope,
  close,
  changed,
  canChange,
}: {
  item: WorkItem | null;
  types: WorkType[];
  options: WorkOptions;
  actorId: string;
  typeId: string;
  scope: string;
  close: () => void;
  changed: (value: WorkItem) => void;
  canChange: boolean;
}) {
  const m = useWorkMessages();
  const c = useCompanyMessages();
  const type = types.find((entry) => entry.id === typeId) ?? types[0];
  const initial: ItemDraft = item
    ? draftForItem(item)
    : {
        typeId: type?.id ?? "",
        stageId: type?.stages.find((stage) => !stage.isArchived)?.id ?? "",
        title: "",
        description: "",
        ownerId: actorId,
        organizationId: null,
        personId: null,
        dealId: null,
        dueDate: null,
        visibility: "owner",
        visibilityGroupId: null,
        values: {},
      };
  const [draft, setDraft] = useState(initial);
  const [baseline, setBaseline] = useState(initial);
  const [record, setRecord] = useState(item);
  const current = useProfileResource(
    record === null ? null : `/api/work-profile/items/${record.id}`,
    workItemSchema,
  );
  const latest = current.data;
  const stale = latest !== null && record !== null && latest.revision > record.revision;
  const command = useProfileCommand(
    `${scope}:item:${item?.id ?? "new"}`,
    commandSchema,
    workItemSchema,
    "/api/work-profile",
  );
  const locked = command.busy || command.command !== null || !canChange;
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  useDepartureGuard(dirty || command.command !== null, c.unsaved);
  const accept = (value: WorkItem | null) => {
    if (value) {
      const next = draftForItem(value);
      setDraft(next);
      setBaseline(next);
      setRecord(value);
      changed(value);
    }
  };
  const { dismiss, confirmation } = useDraftDismissal(
    dirty,
    command.busy || command.command !== null,
    close,
  );
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
            <DialogTitle>{record ? record.title : m.newItem}</DialogTitle>
            <DialogDescription>{m.hubIntro}</DialogDescription>
          </DialogHeader>
          <ItemFields
            value={draft}
            types={types}
            options={options}
            onChange={setDraft}
            disabled={locked || record?.isArchived === true}
            existing={record !== null}
          />
          {current.error !== null ? <ProfileError code={current.error} /> : null}
          {stale ? (
            <div className="space-y-2">
              <p className="text-sm">{c.errorConflict}</p>
              <Button
                variant="outline"
                disabled={command.command !== null}
                onClick={() => {
                  const next = draftForItem(latest);
                  setDraft(rebaseDraft(baseline, draft, next));
                  setBaseline(next);
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
          <div className="flex flex-wrap justify-end gap-2">
            {record ? (
              <Button
                variant="outline"
                disabled={command.busy}
                onClick={() => void current.reload()}
              >
                {c.refresh}
              </Button>
            ) : null}
            {record ? (
              <Button
                variant="outline"
                disabled={locked || dirty || stale}
                onClick={() => {
                  void command
                    .run({
                      action: "archive_item",
                      requestId: crypto.randomUUID(),
                      id: record.id,
                      expectedRevision: record.revision,
                      archived: !record.isArchived,
                    })
                    .then(accept);
                }}
              >
                {record.isArchived ? m.restore : c.archive}
              </Button>
            ) : null}
            <Button
              variant="outline"
              disabled={command.busy || command.command !== null}
              onClick={dismiss}
            >
              {c.cancel}
            </Button>
            <Button
              disabled={
                locked ||
                !dirty ||
                stale ||
                record?.isArchived === true ||
                !itemDraftSchema.safeParse(draft).success
              }
              onClick={() => {
                void command
                  .run(
                    record
                      ? {
                          action: "update_item",
                          requestId: crypto.randomUUID(),
                          id: record.id,
                          expectedRevision: record.revision,
                          item: draft,
                        }
                      : { action: "create_item", requestId: crypto.randomUUID(), item: draft },
                  )
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
