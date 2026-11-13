"use client";
import type { ComponentProps, ReactNode, RefObject } from "react";
import { useMemo, useState } from "react";
import { SdkCombobox } from "@/components/ui/SdkCombobox";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/SdkDialog";
import { ComposeNoteTab } from "@/features/compose/ComposeNoteTab";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { trpc } from "@/lib/trpc-client";

// Global "+ Note" surface (Pipedrive parity). Notes are polymorphic (entity_type, entity_id), so
// unlike the deal/lead/person create modals a note needs a target chosen first. The user picks a
// Person, then the existing ComposeNoteTab writes the note through createNoteAction (no new
// backend). Person is the most common note anchor; other anchors are a future enhancement.
export function GlobalNoteModal({
  controller,
  finalFocus,
  onCreated,
}: {
  controller: NonNullable<ComponentProps<typeof Dialog>["controller"]>;
  finalFocus: RefObject<HTMLButtonElement | null>;
  onCreated: () => void;
}): ReactNode {
  const t = useAppTranslations("quickAdd");
  return (
    <Dialog controller={controller}>
      <DialogContent
        className="max-w-lg"
        initialFocus="[data-slot=combobox-trigger]"
        finalFocus={() => finalFocus.current}
      >
        <DialogTitle className="pe-10">{t("newNote")}</DialogTitle>
        <NoteBody
          onCreated={() => {
            controller.close();
            onCreated();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function NoteBody({ onCreated }: { onCreated: () => void }): ReactNode {
  const t = useAppTranslations("quickAdd");
  const [personId, setPersonId] = useState("");
  const peopleQ = trpc.contacts.personOptions.useQuery(undefined, { retry: false });
  const options = useMemo(
    () => (peopleQ.data ?? []).map((p) => ({ value: p.id, label: p.name, avatarName: p.name })),
    [peopleQ.data],
  );

  return (
    <div className="space-y-3">
      <SdkCombobox
        value={personId}
        onChange={setPersonId}
        options={options}
        ariaLabel={t("noteTarget")}
        placeholder={t("selectPerson")}
      />
      {personId !== "" && (
        <ComposeNoteTab entityType="person" entityId={personId} onNoteCreated={onCreated} />
      )}
    </div>
  );
}
