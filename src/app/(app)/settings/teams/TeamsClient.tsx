"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useSettingsMessages } from "@/features/identity/useSettingsMessages";
import { CreateTeamForm } from "./CreateTeamForm";
import type { TeamUser } from "./teamDraft";

export function TeamsClient({ users }: { users: TeamUser[] }): React.ReactElement {
  const T = useSettingsMessages()._identity.teamEditor;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  function close(): void {
    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" aria-hidden="true" />
          {T.createTitle}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{T.createTitle}</DialogTitle>
          <DialogDescription>{T.createDescription}</DialogDescription>
        </DialogHeader>
        <CreateTeamForm
          users={users}
          onCreated={close}
          onCancel={close}
          onPendingChange={setPending}
        />
      </DialogContent>
    </Dialog>
  );
}
