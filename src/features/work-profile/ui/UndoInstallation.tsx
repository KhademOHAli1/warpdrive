"use client";
import { Button } from "@/components/ui/Button";
import { useCompanyMessages } from "@/features/company-profile/messages";
import { CommandFeedback } from "@/features/company-profile/ui/CommandFeedback";
import { useProfileCommand } from "@/features/company-profile/ui/useProfileApi";
import { commandSchema, type Installation, undoAckSchema, workKindSchema } from "../contracts";
import { useWorkMessages } from "../messages";
export function UndoInstallation({
  installation,
  actorId,
  changed,
}: {
  installation: Installation;
  actorId: string;
  changed: () => void;
}) {
  const c = useCompanyMessages();
  const m = useWorkMessages();
  const command = useProfileCommand(
    `work:${actorId}:undo:${installation.id}`,
    commandSchema,
    undoAckSchema,
    "/api/work-profile",
  );
  const kind = workKindSchema.safeParse(installation.presetId);
  const undone = installation.undoneAt !== null || command.ack !== null;
  return (
    <article className="space-y-3 rounded-md border p-4">
      <div className="flex flex-wrap justify-between gap-3">
        <p className="text-sm font-medium">
          <bdi>{kind.success ? m[kind.data] : installation.presetId}</bdi>
          {` · ${m.version} ${installation.presetVersion}`}
        </p>
        <Button
          variant="outline"
          disabled={undone || command.busy || command.command !== null}
          onClick={() => {
            void command
              .run({
                action: "undo",
                requestId: crypto.randomUUID(),
                installationId: installation.id,
              })
              .then((result) => {
                if (result) changed();
              });
          }}
        >
          {undone ? m.undone : m.undo}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{m.undoHint}</p>
      <ul className="space-y-1 text-xs">
        {installation.resources.map((resource) => (
          <li key={`${resource.kind}:${resource.id}`}>
            <bdi>{resource.key}</bdi> · {resource.created ? m.create : m.reuse}
          </li>
        ))}
      </ul>
      <CommandFeedback
        state={command}
        retry={() => {
          void command.retry().then((result) => {
            if (result) changed();
          });
        }}
        discard={command.discard}
        cancel={() => {
          void command.cancel().then((result) => {
            if (result) changed();
          });
        }}
      />
      {command.error === "in_use" ? <p className="text-sm">{c.errorInUse}</p> : null}
    </article>
  );
}
