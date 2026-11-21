"use client";

import { type FormEvent, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { trpc } from "@/lib/trpc-client";
import {
  type ProjectPriority,
  projectItemDescriptionMaxLength,
  projectItemTitleMaxLength,
  projectPriorities,
} from "../contracts";
import { intakeMessages } from "../intake/messages";
import { ProjectWriteNotice } from "../ui/ProjectTitleDialog";
import { projectsTranslator } from "../ui/projectMessages";
import { useProjectWrites } from "../ui/projectWrites";
import { publicationCsrfToken } from "./clientCsrf";
import type { PublishedIntakeRequest } from "./contracts";
import { publicationMessages } from "./messages";

export function PublicIntakeForm({
  anchor,
  actorId,
  request,
  onSaved,
  cancel,
}: {
  anchor: string;
  actorId: string;
  request?: PublishedIntakeRequest;
  onSaved: () => void;
  cancel?: () => void;
}) {
  const { locale, numberingSystem } = useLocalePreferences();
  const labels = publicationMessages[locale];
  const intake = intakeMessages[locale];
  const projects = projectsTranslator(locale, numberingSystem);
  const fields = useId();
  const intent = useRef<string | null>(null);
  const [title, setTitle] = useState(request?.title ?? "");
  const [description, setDescription] = useState(request?.description ?? "");
  const [priority, setPriority] = useState<ProjectPriority>(request?.priority ?? "none");
  const [sent, setSent] = useState(false);
  const { execute, pending, error } = useProjectWrites();
  const write = trpc.internalProjects.publication.submit.useMutation({ gcTime: 0 });
  const update = trpc.internalProjects.publication.update.useMutation({ gcTime: 0 });
  const unchanged =
    request !== undefined &&
    request.title === title.trim() &&
    request.description === description &&
    request.priority === priority;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || title.trim() === "" || unchanged) return;
    const intentId = intent.current ?? crypto.randomUUID();
    intent.current = intentId;
    void execute(
      async () => {
        const payload = {
          anchor,
          title: title.trim(),
          description,
          priority,
          expectedActorId: actorId,
          csrfToken: await publicationCsrfToken(),
        };
        return request === undefined
          ? write.mutateAsync({ ...payload, intentId })
          : update.mutateAsync({ ...payload, requestId: request.id, revision: request.revision });
      },
      () => {
        onSaved();
        if (request === undefined) {
          setSent(true);
          setTitle("");
          setDescription("");
          setPriority("none");
          intent.current = null;
        }
      },
    );
  }

  return (
    <section className="max-w-xl rounded-lg border bg-card p-4">
      <h2 className="mb-2 text-base font-medium">
        {request === undefined ? labels.request : intake.edit}
      </h2>
      {sent ? (
        <div className="space-y-2">
          <p role="status" className="text-sm">
            {labels.submitted}
          </p>
          <Button type="button" variant="outline" onClick={() => setSent(false)}>
            {labels.another}
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          {request === undefined && (
            <p className="text-sm text-muted-foreground">{labels.requestHelp}</p>
          )}
          <ProjectWriteNotice error={error} labels={projects} />
          <div className="grid gap-1.5 text-sm">
            <label htmlFor={`${fields}-title`}>{labels.title}</label>
            <Input
              id={`${fields}-title`}
              dir="auto"
              value={title}
              maxLength={projectItemTitleMaxLength}
              required
              disabled={pending}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div className="grid gap-1.5 text-sm">
            <label htmlFor={`${fields}-description`}>{labels.description}</label>
            <Textarea
              id={`${fields}-description`}
              dir="auto"
              rows={4}
              value={description}
              maxLength={projectItemDescriptionMaxLength}
              disabled={pending}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <div className="grid gap-1.5 text-sm">
            <span>{labels.priority}</span>
            <Select
              ariaLabel={labels.priority}
              value={priority}
              disabled={pending}
              options={projectPriorities.map((value) => ({
                value,
                label: projects(`priority.${value}`),
              }))}
              contentClassName={`${BLOCK_CLASS} ph-no-capture`}
              onChange={(value) => {
                const selected = projectPriorities.find((priority) => priority === value);
                if (selected !== undefined) setPriority(selected);
              }}
            />
          </div>
          <div className="flex gap-2">
            {cancel !== undefined && (
              <Button type="button" variant="outline" disabled={pending} onClick={cancel}>
                {intake.cancel}
              </Button>
            )}
            <Button type="submit" disabled={pending || title.trim() === "" || unchanged}>
              {request === undefined
                ? pending
                  ? labels.sending
                  : labels.request
                : pending
                  ? intake.working
                  : intake.save}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
