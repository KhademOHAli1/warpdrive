"use client";
import { Plus, User } from "lucide-react";
import Link from "next/link";
import type React from "react";
import { useState } from "react";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { CollapsibleSection } from "../CollapsibleSection";
import { ParticipantsDialog } from "../ParticipantsDialog";
import { useParticipants } from "../useParticipants";

export function ParticipantsSection({
  title,
  dealId,
  orgId,
  orgName,
}: {
  title: string;
  dealId: string;
  orgId: string | null;
  orgName: string | null;
}): React.ReactNode {
  const translateSales = useAppTranslations("sales");

  const [open, setOpen] = useState(false);
  const data = useParticipants(dealId, orgId);
  const hasAddedParticipant = data.participants.some((p) => !p.isPrimary);
  if (!hasAddedParticipant) return null;

  return (
    <CollapsibleSection
      title={title}
      showFilter={false}
      headerActions={() => (
        <button
          type="button"
          aria-label={translateSales("add_participant_464c3")}
          onClick={() => setOpen(true)}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Plus aria-hidden="true" className="h-4 w-4" />
        </button>
      )}
    >
      <ul className="space-y-1.5 py-1">
        {data.participants.map((p) => (
          <li key={p.personId} className="flex items-center gap-2 text-sm">
            <User aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <Link
              href={`/contacts/people/${p.personId}`}
              className="min-w-0 truncate font-semibold text-primary hover:underline"
            >
              <bdi dir="auto">{p.name}</bdi>
            </Link>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1 rounded-md border px-2.5 py-1 text-sm transition-[background-color,scale] duration-150 ease-out hover:bg-accent active:scale-[0.96]"
      >
        {translateSales("view_all_ff557")}
      </button>
      <ParticipantsDialog
        open={open}
        onOpenChange={setOpen}
        title={orgName ?? translateSales("this_deal_1fcce")}
        orgId={orgId}
        data={data}
      />
    </CollapsibleSection>
  );
}
