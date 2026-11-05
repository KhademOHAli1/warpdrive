"use client";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { useCompanyMessages } from "@/features/company-profile/messages";
import { CommandFeedback } from "@/features/company-profile/ui/CommandFeedback";
import { useProfileCommand } from "@/features/company-profile/ui/useProfileApi";
import { commandSchema, type Overview, type WorkType, workTypeSchema } from "../contracts";
import { useWorkMessages } from "../messages";
import { TypeEditor } from "./TypeEditor";

function ArchiveType({
  type,
  actorId,
  changed,
}: {
  type: WorkType;
  actorId: string;
  changed: (value: WorkType) => void;
}) {
  const c = useCompanyMessages();
  const m = useWorkMessages();
  const command = useProfileCommand(
    `work:${actorId}:archive_type:${type.id}`,
    commandSchema,
    workTypeSchema,
    "/api/work-profile",
  );
  const accept = (result: WorkType | null) => {
    if (result) changed(result);
  };
  return (
    <div>
      <Button
        variant="ghost"
        disabled={command.busy || command.command !== null}
        onClick={() => {
          void command
            .run({
              action: "archive_type",
              requestId: crypto.randomUUID(),
              id: type.id,
              expectedRevision: type.revision,
              archived: !type.isArchived,
            })
            .then(accept);
        }}
      >
        {type.isArchived ? m.restore : c.archive}
      </Button>
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
    </div>
  );
}
export function TypeManager({
  data,
  actorId,
  changed,
}: {
  data: Overview;
  actorId: string;
  changed: () => void;
}) {
  const c = useCompanyMessages();
  const m = useWorkMessages();
  const [editing, setEditing] = useState<{ type: WorkType | null } | null>(null);
  const [local, setLocal] = useState<WorkType[]>([]);
  const records = new Map(data.workTypes.map((type) => [type.id, type]));
  for (const type of local)
    if ((records.get(type.id)?.revision ?? -1) <= type.revision) records.set(type.id, type);
  const accept = (type: WorkType) => {
    setLocal([...local.filter((entry) => entry.id !== type.id), type]);
    changed();
  };
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h2 className="font-semibold">{m.configuration}</h2>
        {data.permissions.manage ? (
          <Button variant="outline" onClick={() => setEditing({ type: null })}>
            {m.newType}
          </Button>
        ) : null}
      </div>
      {[...records.values()].map((type) => (
        <article
          key={type.id}
          className="flex flex-wrap justify-between gap-4 rounded-md border p-4"
        >
          <div>
            <h3 className="font-medium">{type.name}</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {type.stages.map((stage) => stage.name).join(" · ")}
              {type.isArchived ? ` · ${c.archived}` : ""}
            </p>
          </div>
          {data.permissions.manage ? (
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setEditing({ type })}>
                {m.edit}
              </Button>
              <ArchiveType
                type={type}
                actorId={`${data.workspaceScope}:${actorId}`}
                changed={accept}
              />
            </div>
          ) : null}
        </article>
      ))}
      {editing ? (
        <TypeEditor
          type={editing.type}
          latest={editing.type ? (records.get(editing.type.id) ?? null) : null}
          reload={changed}
          actorId={`${data.workspaceScope}:${actorId}`}
          changed={accept}
          close={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}
