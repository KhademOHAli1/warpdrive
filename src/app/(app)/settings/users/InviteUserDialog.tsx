"use client";

import { UserPlus } from "lucide-react";
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
import { InviteUserForm } from "./InviteUserForm";

export function InviteUserDialog({
  viewerIsAdmin,
  onInvited,
}: {
  viewerIsAdmin: boolean;
  onInvited: () => void;
}): React.ReactElement {
  const L = useSettingsMessages();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button className="w-full sm:w-auto">
          <UserPlus className="size-4" aria-hidden="true" />
          {L._extra.invite_a_user}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto p-0">
        <DialogHeader className="border-b px-5 py-4 pe-12">
          <DialogTitle>{L._extra.invite_a_user}</DialogTitle>
          <DialogDescription>
            {L._extra.add_a_teammate_and_choose_whether_they_can_manage_company_}
          </DialogDescription>
        </DialogHeader>
        <InviteUserForm
          embedded
          viewerIsAdmin={viewerIsAdmin}
          onInvited={onInvited}
          onPendingChange={setPending}
          onCancel={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
