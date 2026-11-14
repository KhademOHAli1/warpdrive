"use client";
import type { RefObject } from "react";
import { useSalesStrings } from "@/features/deals/useSalesStrings";
import { LinkSwitchDialog } from "./LinkSwitchDialog";

interface OrgSwitchDialogProps {
  open: boolean;
  currentOrgId: string | null;
  options: Array<{ id: string; name: string }>;
  menuTrigger: RefObject<HTMLButtonElement | null>;
  onOpenChange: (open: boolean) => void;
  onSave: (orgId: string, saveButton: HTMLButtonElement) => Promise<void>;
}

export function OrgSwitchDialog({
  open,
  currentOrgId,
  options,
  onOpenChange,
  menuTrigger,
  onSave,
}: OrgSwitchDialogProps) {
  const strings = useSalesStrings().dealSidebar.orgDialog;
  return (
    <LinkSwitchDialog
      open={open}
      menuTrigger={menuTrigger}
      currentId={currentOrgId}
      title={strings.title}
      label={strings.organization}
      cancelLabel={strings.cancel}
      saveLabel={strings.save}
      options={options.map((org) => ({
        value: org.id,
        label: org.name,
        avatarName: org.name,
      }))}
      canSave={(id) => id !== ""}
      onOpenChange={onOpenChange}
      onSave={onSave}
    />
  );
}
