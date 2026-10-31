"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/Button";
import { useSettingsMessages } from "@/features/identity/useSettingsMessages";

export function LeaveImportDialog({ pending }: { pending: boolean }) {
  const J = useSettingsMessages()._extra.importJourney;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" size="sm" disabled={pending} onClick={() => setOpen(true)}>
        {J.leave}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={J.leaveTitle}
        description={J.leaveDescription}
        confirmLabel={J.leaveConfirm}
        cancelLabel={J.stay}
        pending={pending}
        onConfirm={() => router.push("/settings/import")}
      />
    </>
  );
}
