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
import {
  companyCommandSchema,
  type LegalEntity,
  legalEntityDataSchema,
  legalEntitySchema,
} from "../contracts";
import { useCompanyMessages } from "../messages";
import { CommandFeedback } from "./CommandFeedback";
import { PRIVATE } from "./Fields";
import { LegalFields } from "./LegalFields";
import { rebaseDraft } from "./rebaseDraft";
import { useDepartureGuard, useDraftDismissal } from "./useDepartureGuard";
import { useProfileCommand } from "./useProfileApi";
export function LegalEntityEditor({
  entity,
  latest,
  reload,
  entities,
  scope,
  saved,
  close,
}: {
  entity: LegalEntity | null;
  latest: LegalEntity | null;
  reload: () => Promise<void>;
  entities: LegalEntity[];
  scope: string;
  saved: (value: LegalEntity) => void;
  close: () => void;
}) {
  const m = useCompanyMessages();
  const initial = entity?.data ?? {
    ...legalEntityDataSchema.parse({ legalName: "-", country: "DE" }),
    legalName: "",
    country: "",
  };
  const [draft, setDraft] = useState(initial);
  const [baseline, setBaseline] = useState(initial);
  const [record, setRecord] = useState(entity);
  const command = useProfileCommand(
    `${scope}:legal:${entity?.id ?? "new"}`,
    companyCommandSchema,
    legalEntitySchema,
    "/api/company-profile",
  );
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  useDepartureGuard(dirty || command.command !== null, m.unsaved);
  const accept = (value: LegalEntity | null) => {
    if (value) {
      setRecord(value);
      setDraft(value.data);
      setBaseline(value.data);
      saved(value);
    }
  };
  const { dismiss, confirmation } = useDraftDismissal(
    dirty,
    command.command !== null || command.busy,
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
            <DialogTitle>{entity === null ? m.newEntity : m.legal}</DialogTitle>
            <DialogDescription>{m.legalHint}</DialogDescription>
          </DialogHeader>
          <LegalFields
            key={record?.revision}
            value={draft}
            entities={entities.filter((entry) => entry.id !== record?.id)}
            onChange={setDraft}
            disabled={command.busy || command.command !== null}
          />
          {latest && record && latest.revision > record.revision ? (
            <div className="space-y-2">
              <p className="text-sm">{m.errorConflict}</p>
              <Button
                variant="outline"
                disabled={command.command !== null}
                onClick={() => {
                  setDraft(rebaseDraft(baseline, draft, latest.data));
                  setBaseline(latest.data);
                  setRecord(latest);
                }}
              >
                {m.review}
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
              <Button variant="outline" disabled={command.busy} onClick={() => void reload()}>
                {m.refresh}
              </Button>
            ) : null}
            <Button
              variant="outline"
              disabled={command.busy || command.command !== null}
              onClick={dismiss}
            >
              {m.cancel}
            </Button>
            <Button
              disabled={
                command.busy ||
                command.command !== null ||
                !dirty ||
                !legalEntityDataSchema.safeParse(draft).success
              }
              onClick={() => {
                void command
                  .run({
                    action: "save_legal_entity",
                    requestId: crypto.randomUUID(),
                    id: record?.id ?? null,
                    expectedRevision: record?.revision ?? 0,
                    data: draft,
                  })
                  .then(accept);
              }}
            >
              {command.busy ? m.saving : m.save}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {confirmation}
    </>
  );
}
