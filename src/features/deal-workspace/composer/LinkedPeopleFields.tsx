"use client";
import type React from "react";
import { Combobox, type ComboboxOption } from "@/components/ui/Combobox";
import { MultiCombobox } from "@/components/ui/MultiCombobox";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";

interface Owner {
  id: string;
  name: string;
  avatarUrl?: string | null;
}

interface ParticipantOption {
  id: string;
  name: string;
}

// Owner (-> assigneeId) and Guests/Participants (-> guestPersonIds) selects, split out of
// ActivityComposerInline both to hold that file under the size target AND so the composer can
// place them in separate icon rows (PD puts Guests high, Owner near the bottom). The visible
// text labels are dropped; the leading icon in each ComposerFieldRow conveys the field, and the
// select's ariaLabel keeps it accessible.

export function OwnerField({
  owners,
  ownerId,
  onOwner,
}: {
  owners: Owner[];
  ownerId: string;
  onOwner: (id: string) => void;
}): React.ReactNode {
  const translateSales = useAppTranslations("sales");

  return (
    <Combobox
      ariaLabel={translateSales("owner_4b1b8")}
      value={ownerId}
      onChange={onOwner}
      options={[
        { value: "", label: translateSales("computed.me") },
        ...owners.map<ComboboxOption>((u) => ({
          value: u.id,
          label: u.name,
          avatarName: u.name,
          avatarUrl: u.avatarUrl ?? null,
        })),
      ]}
    />
  );
}

export function GuestsField({
  participantOptions,
  participants,
  onParticipants,
}: {
  participantOptions: ParticipantOption[];
  participants: string[];
  onParticipants: (ids: string[]) => void;
}): React.ReactNode {
  const translateSales = useAppTranslations("sales");

  return (
    <MultiCombobox
      ariaLabel={translateSales("participants_0e272")}
      values={participants}
      onChange={onParticipants}
      options={participantOptions.map((p) => ({ value: p.id, label: p.name }))}
      placeholder={translateSales("add_guests_ef330")}
    />
  );
}
