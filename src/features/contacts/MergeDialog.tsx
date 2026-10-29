"use client";
// Shared survivor/merge-partner dialog for organization and person records. The
// only client-supplied field the merge action trusts is the survivor's own name
// (fieldChoicesSchema strips everything else), so this dialog picks a partner and
// a survivor and sends an empty fieldChoices; the survivor keeps its name.
import type React from "react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Select, type SelectOption } from "@/components/ui/Select";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { trpc } from "@/lib/trpc-client";
import { readCsrfToken } from "@/utils/csrfCookie";
import { mergeOrgsAction, mergePersonsAction } from "./actions";

type Option = { id: string; name: string };

export interface MergeDialogProps {
  kind: "org" | "person";
  current: Option;
  // Receives the survivor id: the current record may itself be merged away, so the
  // caller navigates to the survivor rather than refreshing a now-deleted URL.
  onMerged: (survivorId: string) => void;
  onClose?: () => void;
}

export function MergeDialog({
  kind,
  current,
  onMerged,
  onClose,
}: MergeDialogProps): React.ReactNode {
  const tContacts = useAppTranslations("contacts");

  const orgQ = trpc.contacts.orgOptions.useQuery(undefined, { enabled: kind === "org" });
  const personQ = trpc.contacts.personOptions.useQuery(undefined, { enabled: kind === "person" });
  const all: Option[] = (kind === "org" ? orgQ.data : personQ.data) ?? [];
  const candidates = all.filter((o) => o.id !== current.id);

  const [partnerId, setPartnerId] = useState<string>("");
  const [survivorId, setSurvivorId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const partner = candidates.find((c) => c.id === partnerId) ?? null;
  const survivorOptions: Option[] = partner === null ? [] : [current, partner];
  const canConfirm = partnerId !== "" && survivorId !== "" && !pending;

  async function confirm(): Promise<void> {
    if (partner === null || survivorId === "") return;
    setError(null);
    setPending(true);
    try {
      const mergedId = survivorId === current.id ? partner.id : current.id;
      const csrf = readCsrfToken();
      const args = { survivorId, mergedId, fieldChoices: {} };
      const result =
        kind === "org" ? await mergeOrgsAction(args, csrf) : await mergePersonsAction(args, csrf);
      if (!result.ok) {
        setError(tContacts("mergeError", { errorId: result.error.id }));
        return;
      }
      onMerged(survivorId);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-3 rounded-md border bg-card p-4">
      <div className="space-y-1">
        <span className="block text-sm text-muted-foreground">{tContacts("mergeWith")}</span>
        <Select
          ariaLabel={tContacts("mergeWith")}
          value={partnerId}
          onChange={(next) => {
            setPartnerId(next);
            setSurvivorId("");
          }}
          placeholder={tContacts("selectARecord")}
          options={[
            { value: "", label: tContacts("selectARecord") },
            ...candidates.map<SelectOption>((c) => ({ value: c.id, label: c.name })),
          ]}
        />
      </div>

      <div className="space-y-1">
        <span className="block text-sm text-muted-foreground">{tContacts("survivor")}</span>
        <div className={partner === null ? "pointer-events-none opacity-50" : undefined}>
          <Select
            ariaLabel={tContacts("survivor")}
            value={survivorId}
            onChange={setSurvivorId}
            placeholder={tContacts("selectTheSurvivor")}
            options={[
              { value: "", label: tContacts("selectTheSurvivor") },
              ...survivorOptions.map<SelectOption>((o) => ({ value: o.id, label: o.name })),
            ]}
          />
        </div>
      </div>

      {error !== null && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex justify-end gap-2">
        {onClose !== undefined && (
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            {tContacts("cancel")}
          </Button>
        )}
        <Button type="button" size="sm" disabled={!canConfirm} onClick={() => void confirm()}>
          {tContacts("merge")}
        </Button>
      </div>
    </div>
  );
}
