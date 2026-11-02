"use client";

import { ShieldPlus } from "lucide-react";
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
import { CreatePermissionSetForm } from "./CreatePermissionSetForm";

export function CreatePermissionSetDialog({
  onCreated,
  disabled,
}: {
  onCreated: () => void;
  disabled: boolean;
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
        <Button disabled={disabled} className="w-full sm:w-auto">
          <ShieldPlus className="size-4" aria-hidden="true" />
          {L._extra.create_a_permission_set}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto p-0">
        <DialogHeader className="border-b px-5 py-4 pe-12">
          <DialogTitle>{L._extra.create_a_permission_set}</DialogTitle>
          <DialogDescription>
            {L._extra.bundle_access_rules_that_can_be_assigned_to_users}
          </DialogDescription>
        </DialogHeader>
        <CreatePermissionSetForm
          embedded
          onPendingChange={setPending}
          onCancel={() => setOpen(false)}
          onCreated={() => {
            setOpen(false);
            onCreated();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
