"use client";

import { type FormEvent, useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { trpc } from "@/lib/trpc-client";
import { readCsrfToken } from "@/utils/csrfCookie";
import {
  projectItemDescriptionMaxLength,
  projectItemTitleMaxLength,
  projectPriorities,
} from "../../contracts";
import { ProjectWriteNotice } from "../../ui/ProjectTitleDialog";
import type { ProjectsTranslator } from "../../ui/projectMessages";
import { useProjectWrites } from "../../ui/projectWrites";
import type { ProjectIntakeRequest } from "../contracts";
import type { IntakeMessages } from "../messages";

export function IntakeEditorDialog({
  actorId,
  projectId,
  existing,
  labels,
  projects,
  close,
  onSaved,
}: {
  actorId: string;
  projectId: string;
  existing: ProjectIntakeRequest | null;
  labels: IntakeMessages;
  projects: ProjectsTranslator;
  close: () => void;
  onSaved: (id: string) => void;
}) {
  const create = trpc.internalProjects.intake.create.useMutation({ gcTime: 0 });
  const update = trpc.internalProjects.intake.update.useMutation({ gcTime: 0 });
  const { pending, execute, error } = useProjectWrites();
  const [title, setTitle] = useState(existing?.title ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [priority, setPriority] = useState(existing?.priority ?? "none");
  const [intentId, setIntentId] = useState<string | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const heading = existing === null ? labels.submit : labels.edit;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (title.trim() === "" || pending) return;
    const payload = {
      expectedActorId: actorId,
      csrfToken: readCsrfToken(),
      projectId,
      title: title.trim(),
      description,
      priority,
    };
    if (existing !== null) {
      void execute(
        () =>
          update.mutateAsync({ ...payload, requestId: existing.id, revision: existing.revision }),
        ({ id }) => onSaved(id),
      );
      return;
    }
    const intent = intentId ?? crypto.randomUUID();
    setIntentId(intent);
    void execute(
      () => create.mutateAsync({ ...payload, intentId: intent }),
      ({ id }) => onSaved(id),
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) close();
      }}
    >
      <DialogContent className={BLOCK_CLASS}>
        <DialogHeader>
          <DialogTitle>{heading}</DialogTitle>
          <DialogDescription className="sr-only">{heading}</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <ProjectWriteNotice error={error} labels={projects} />
          <div className="grid gap-1.5">
            <label htmlFor={titleId} className="text-sm font-medium">
              {labels.name}
            </label>
            <Input
              id={titleId}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
              maxLength={projectItemTitleMaxLength}
              disabled={pending}
              dir="auto"
            />
          </div>
          <div className="grid gap-1.5">
            <label htmlFor={descriptionId} className="text-sm font-medium">
              {labels.description}
            </label>
            <Textarea
              id={descriptionId}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={projectItemDescriptionMaxLength}
              disabled={pending}
              rows={5}
              dir="auto"
            />
          </div>
          <Select
            ariaLabel={labels.priority}
            value={priority}
            disabled={pending}
            options={projectPriorities.map((value) => ({
              value,
              label: projects(`priority.${value}`),
            }))}
            onChange={(value) =>
              setPriority(projectPriorities.find((option) => option === value) ?? "none")
            }
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close} disabled={pending}>
              {labels.cancel}
            </Button>
            <Button type="submit" disabled={pending || title.trim() === ""}>
              {pending ? labels.working : existing === null ? labels.submit : labels.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
