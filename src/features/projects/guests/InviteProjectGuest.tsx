"use client";

import { UserRoundPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/Input";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { trpc } from "@/lib/trpc-client";
import { readCsrfToken } from "@/utils/csrfCookie";
import type { ProjectPerson } from "../contracts";
import { ProjectWriteNotice } from "../ui/ProjectTitleDialog";
import { projectsTranslator } from "../ui/projectMessages";
import { guestLabels } from "./messages";

export function InviteProjectGuest({
  actorId,
  projectId,
  onInvited,
}: {
  actorId: string;
  projectId: string;
  onInvited: (member: ProjectPerson) => void;
}) {
  const { locale, numberingSystem } = useLocalePreferences();
  const labels = guestLabels[locale];
  const baseLabels = projectsTranslator(locale, numberingSystem);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const nameId = useId();
  const emailId = useId();
  const invite = trpc.internalProjects.guests.invite.useMutation({
    onSuccess(result, input) {
      if (result.ok && result.value.outcome === "invited") {
        onInvited({ id: result.value.userId, name: input.name.trim() });
        setSent(true);
        setOpen(false);
        router.refresh();
      }
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const name = values.get("name");
    const email = values.get("email");
    if (typeof name !== "string" || typeof email !== "string" || invite.isPending) return;
    invite.mutate({
      projectId,
      expectedActorId: actorId,
      csrfToken: readCsrfToken(),
      name,
      email,
      locale,
    });
  }

  return (
    <div className="space-y-2">
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (invite.isPending) return;
          if (next) {
            invite.reset();
            setSent(false);
          }
          setOpen(next);
        }}
      >
        <DialogTrigger asChild>
          <Button variant="outline">
            <UserRoundPlus aria-hidden className="size-4" />
            {labels.invite}
          </Button>
        </DialogTrigger>
        <DialogContent className={`${BLOCK_CLASS} ph-no-capture`}>
          <DialogHeader>
            <DialogTitle>{labels.invite}</DialogTitle>
            <DialogDescription>{labels.inviteHelp}</DialogDescription>
          </DialogHeader>
          <form className="space-y-3" onSubmit={submit}>
            <label htmlFor={nameId} className="block space-y-1 text-sm">
              {labels.name}
              <Input id={nameId} name="name" maxLength={120} required />
            </label>
            <label htmlFor={emailId} className="block space-y-1 text-sm">
              {labels.email}
              <Input id={emailId} type="email" name="email" maxLength={254} required />
            </label>
            {invite.data?.ok === true && invite.data.value.outcome === "email_unavailable" && (
              <p role="alert" className="text-sm text-destructive">
                {labels.emailUnavailable}
              </p>
            )}
            <ProjectWriteNotice
              error={
                invite.data?.ok === false
                  ? invite.data.error
                  : invite.isError
                    ? "project_unavailable"
                    : null
              }
              labels={baseLabels}
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)} disabled={invite.isPending}>
                {baseLabels("actions.cancel")}
              </Button>
              <Button type="submit" disabled={invite.isPending}>
                {labels.invite}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {sent && (
        <p role="status" className="text-sm text-muted-foreground">
          {labels.queued}
        </p>
      )}
    </div>
  );
}
