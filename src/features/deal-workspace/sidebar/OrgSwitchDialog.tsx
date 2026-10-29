"use client";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Combobox, type ComboboxOption } from "@/components/ui/Combobox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useSalesStrings } from "@/features/deals/useSalesStrings";

interface OrgSwitchDialogProps {
  open: boolean;
  currentOrgId: string | null;
  options: Array<{ id: string; name: string }>;
  onOpenChange: (open: boolean) => void;
  onSave: (orgId: string) => Promise<void>;
}

export function OrgSwitchDialog({
  open,
  currentOrgId,
  options,
  onOpenChange,
  onSave,
}: OrgSwitchDialogProps) {
  const STRINGS = useSalesStrings();

  const [orgId, setOrgId] = useState(currentOrgId ?? "");
  const [pending, setPending] = useState(false);
  const comboOptions: ComboboxOption[] = options.map((org) => ({
    value: org.id,
    label: org.name,
    avatarName: org.name,
  }));

  async function save(): Promise<void> {
    if (orgId === "") return;
    setPending(true);
    await onSave(orgId);
    setPending(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setOrgId(currentOrgId ?? "");
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            <bdi dir="auto">{STRINGS.dealSidebar.orgDialog.title}</bdi>
          </DialogTitle>
        </DialogHeader>
        <Combobox
          ariaLabel={STRINGS.dealSidebar.orgDialog.organization}
          value={orgId}
          options={comboOptions}
          onChange={setOrgId}
          placeholder={STRINGS.dealSidebar.orgDialog.organization}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            {STRINGS.dealSidebar.orgDialog.cancel}
          </Button>
          <Button onClick={() => void save()} disabled={pending || orgId === ""}>
            {STRINGS.dealSidebar.orgDialog.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
