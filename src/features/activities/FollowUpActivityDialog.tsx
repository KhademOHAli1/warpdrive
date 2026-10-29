"use client";
import type React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ActivityComposerInline } from "@/features/deal-workspace/composer/ActivityComposerInline";
import type { FollowUpLinks } from "./followUpLinks";
import { useActivitiesMessages } from "./useActivitiesMessages";

export function FollowUpActivityDialog({
  links,
  onCreated,
  onClose,
}: {
  links: FollowUpLinks;
  onCreated: () => void;
  onClose: () => void;
}): React.ReactNode {
  const S = useActivitiesMessages();
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        className="max-h-[90vh] max-w-2xl gap-0 overflow-y-auto bg-card p-0"
      >
        <DialogHeader className="border-b px-5 py-3">
          <DialogTitle className="text-base font-semibold">{S.addActivity}</DialogTitle>
        </DialogHeader>
        <div className="px-3 py-2">
          <ActivityComposerInline
            dealId={links.dealId}
            leadId={links.leadId}
            personId={links.personId}
            orgId={links.orgId}
            personName={links.personName ?? undefined}
            orgName={links.orgName ?? undefined}
            dealTitle={links.dealTitle ?? undefined}
            onCreated={onCreated}
            onCancel={onClose}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
