"use client";
import type { RefObject } from "react";
import { useSalesStrings } from "@/features/deals/useSalesStrings";
import { trpc } from "@/lib/trpc-client";
import { LinkSwitchDialog } from "./LinkSwitchDialog";

export function PersonSwitchDialog({
  open,
  currentPersonId,
  onOpenChange,
  menuTrigger,
  onSave,
}: {
  open: boolean;
  currentPersonId: string | null;
  menuTrigger: RefObject<HTMLButtonElement | null>;
  onOpenChange: (open: boolean) => void;
  onSave: (personId: string, saveButton: HTMLButtonElement) => Promise<void>;
}) {
  const strings = useSalesStrings().dealSidebar.personDialog;
  const people = trpc.contacts.personOptions.useQuery(undefined, { enabled: open });

  return (
    <LinkSwitchDialog
      open={open}
      menuTrigger={menuTrigger}
      currentId={currentPersonId}
      title={strings.title}
      label={strings.person}
      cancelLabel={strings.cancel}
      saveLabel={strings.save}
      options={people.data?.map((person) => ({
        value: person.id,
        label: person.name,
        avatarName: person.name,
      }))}
      loadError={people.isError ? strings.loadFailed : undefined}
      canSave={(id) => id !== "" && id !== currentPersonId}
      onOpenChange={onOpenChange}
      onSave={onSave}
    />
  );
}
