"use client";
import { Plus } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { ParticipantsDialog } from "./ParticipantsDialog";
import { useParticipants } from "./useParticipants";

// Summary-row participants trigger (Pipedrive parity): "+ Participants" while the deal has none,
// then an "N participants" count-link. Either opens the participants table dialog.
export function ParticipantsControl({
  dealId,
  orgId,
  orgName,
}: {
  dealId: string;
  orgId: string | null;
  orgName: string | null;
}): React.ReactNode {
  const translateSales = useAppTranslations("sales");

  const [open, setOpen] = useState(false);
  const data = useParticipants(dealId, orgId);
  const count = data.participants.length;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-0.5 text-sm font-semibold text-primary hover:underline"
      >
        {count === 0 ? (
          <>
            <Plus aria-hidden="true" className="h-3.5 w-3.5" />
            {translateSales("participants_0e272")}
          </>
        ) : (
          translateSales("computed.participantCount", { count })
        )}
      </button>
      <ParticipantsDialog
        open={open}
        onOpenChange={setOpen}
        title={orgName ?? translateSales("this_deal_1fcce")}
        orgId={orgId}
        data={data}
      />
    </>
  );
}
