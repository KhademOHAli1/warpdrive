"use client";
import type React from "react";
import { useRef, useState } from "react";
import { Input } from "@/components/ui/Input";
import { EntityCombobox, type EntityPick } from "@/features/entity-create/EntityCombobox";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { trpc } from "@/lib/trpc-client";

export function ParticipantLinkField({
  linked,
  orgId,
  onPick,
}: {
  linked: ReadonlyArray<{ id: string; name: string }>;
  orgId: string | null;
  onPick: (pick: EntityPick) => Promise<string | null>;
}): React.ReactNode {
  const translateSales = useAppTranslations("sales");

  const peopleQ = trpc.contacts.personOptions.useQuery();
  const orgPeopleQ = trpc.contacts.listPeopleForOrg.useQuery(
    { orgId: orgId ?? "" },
    { enabled: orgId !== null },
  );
  const [error, setError] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const inFlight = useRef(false);
  const linkedIds = new Set(linked.map((p) => p.id));

  function alreadyLinked(pick: EntityPick): string | undefined {
    if (pick.kind === "existing") return linked.find((p) => p.id === pick.id)?.name;
    const key = pick.name.trim().toLowerCase();
    return linked.find((p) => p.name.trim().toLowerCase() === key)?.name;
  }

  async function handlePick(pick: EntityPick): Promise<void> {
    if (inFlight.current) return;
    setError(null);
    const existing = alreadyLinked(pick);
    if (existing !== undefined) {
      setError(translateSales("computed.alreadyParticipant", { name: existing }));
      setResetKey((k) => k + 1);
      return;
    }
    inFlight.current = true;
    try {
      const message = await onPick(pick);
      setError(message);
      if (message === null) setResetKey((k) => k + 1);
    } finally {
      inFlight.current = false;
    }
  }

  const people = peopleQ.data;
  const orgPeople = orgPeopleQ.data?.map((p) => ({ id: p.id, name: p.name }));
  const awaitingOrgPeople =
    orgId !== null && orgPeople === undefined && orgPeopleQ.isError !== true;
  const message = peopleQ.isError ? translateSales("computed.loadPeopleFailed") : error;
  return (
    <div className="w-64">
      {people === undefined || awaitingOrgPeople ? (
        <Input
          aria-label={translateSales("computed.linkParticipant")}
          placeholder={translateSales("computed.linkParticipant")}
          disabled
          readOnly
        />
      ) : (
        <EntityCombobox
          key={resetKey}
          label={translateSales("computed.linkParticipant")}
          hideLabel
          options={people}
          defaultOptions={orgPeople}
          excludeIds={linkedIds}
          placeholder={translateSales("computed.linkParticipant")}
          createLabel={(q) => translateSales("add_arg0_as_new_person_11c06", { arg0: q })}
          onSelectExisting={() => undefined}
          onCreateNew={() => undefined}
          onClear={() => undefined}
          onPick={(pick) => void handlePick(pick)}
        />
      )}
      {message !== null && (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {message}
        </p>
      )}
    </div>
  );
}
