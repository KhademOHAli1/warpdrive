"use client";

import { type ReactElement, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import type { ProjectResult, ProjectStatus, ProjectWorkspace } from "../contracts";
import { type ProjectWorkItemDraft, ProjectWorkItemForm } from "./ProjectWorkItemForm";
import type { ProjectsTranslator } from "./projectMessages";

export function ProjectWorkItemCreate({
  workspace,
  status,
  trigger,
  pending,
  labels,
  submit,
}: {
  workspace: ProjectWorkspace;
  status: ProjectStatus;
  trigger: ReactElement;
  pending: boolean;
  labels: ProjectsTranslator;
  submit: (draft: ProjectWorkItemDraft, intent: string) => Promise<ProjectResult<ProjectWorkspace>>;
}) {
  const [open, setOpen] = useState(false);
  const intent = useRef<string | null>(null);
  function changeOpen(value: boolean) {
    if (pending) return;
    if (value) intent.current = null;
    setOpen(value);
  }
  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className={`max-h-[90dvh] overflow-y-auto ${BLOCK_CLASS} ph-no-capture`}>
        <DialogHeader>
          <DialogTitle>{labels("workspace.create")}</DialogTitle>
          <DialogDescription>{labels("workspace.newDescription")}</DialogDescription>
        </DialogHeader>
        {open && (
          <ProjectWorkItemForm
            workspace={workspace}
            pending={pending}
            labels={labels}
            cancel={() => changeOpen(false)}
            initial={{
              title: "",
              description: "",
              priority: "none",
              status,
              startDate: null,
              dueDate: null,
              assigneeId: null,
            }}
            submit={async (draft) => {
              intent.current ??= crypto.randomUUID();
              const result = await submit(draft, intent.current);
              if (!result.ok) return result.error;
              setOpen(false);
              return null;
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
