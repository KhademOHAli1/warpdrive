"use client";
import { Trash2 } from "lucide-react";
import Link from "next/link";
import type React from "react";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { formatUserName } from "@/features/identity/formatUserName";
import { useFormatters } from "@/lib/useFormatters";
import { ParticipantLinkField } from "./ParticipantLinkField";
import type { useParticipants } from "./useParticipants";

export function ParticipantsDialog({
  open,
  onOpenChange,
  title,
  orgId,
  data,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  orgId: string | null;
  data: ReturnType<typeof useParticipants>;
}): React.ReactNode {
  const translateSales = useAppTranslations("sales");
  const format = useFormatters();

  const { participants, add, remove, createAndAdd } = data;
  const [removeError, setRemoveError] = useState<string | null>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>
            {translateSales("participants_b1383")}
            <bdi dir="auto">{title}</bdi>)
          </DialogTitle>
        </DialogHeader>

        {open && (
          <ParticipantLinkField
            linked={participants.map((p) => ({ id: p.personId, name: p.name }))}
            orgId={orgId}
            onPick={(pick) => (pick.kind === "existing" ? add(pick.id) : createAndAdd(pick.name))}
          />
        )}
        {removeError !== null && (
          <p role="alert" className="text-xs text-destructive">
            {removeError}
          </p>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-start text-xs text-muted-foreground">
                <th className="py-2 pe-3 font-medium">{translateSales("name_dcd1d")}</th>
                <th className="py-2 pe-3 font-medium">{translateSales("organization_d764d")}</th>
                <th className="py-2 pe-3 font-medium">{translateSales("email_969cc")}</th>
                <th className="py-2 pe-3 font-medium">{translateSales("phone_63dce")}</th>
                <th className="py-2 pe-3 font-medium">{translateSales("closed_deals_aaffc")}</th>
                <th className="py-2 pe-3 font-medium">{translateSales("open_deals_bf562")}</th>
                <th className="py-2 pe-3 font-medium">
                  {translateSales("next_activity_date_20fb2")}
                </th>
                <th className="py-2 pe-3 font-medium">{translateSales("owner_4b1b8")}</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {participants.map((p) => (
                <tr key={p.personId} className="border-b last:border-b-0">
                  <td className="py-2 pe-3">
                    <Link
                      href={`/contacts/people/${p.personId}`}
                      className="font-semibold text-primary hover:underline"
                    >
                      <bdi dir="auto">{p.name}</bdi>
                    </Link>
                  </td>
                  <td className="py-2 pe-3">
                    <bdi dir="auto">{p.orgName ?? "-"}</bdi>
                  </td>
                  <td className="py-2 pe-3">
                    <bdi dir="ltr">{p.primaryEmail ?? "-"}</bdi>
                  </td>
                  <td className="py-2 pe-3">
                    <bdi dir="ltr">{p.phone ?? "-"}</bdi>
                  </td>
                  <td className="py-2 pe-3 tabular-nums">{format.number(p.closedDeals)}</td>
                  <td className="py-2 pe-3 tabular-nums">{format.number(p.openDeals)}</td>
                  <td className="py-2 pe-3">
                    {p.nextActivityAt !== null
                      ? format.dateTime(p.nextActivityAt, {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })
                      : "-"}
                  </td>
                  {/* formatUserName: demo/seed users carry their email as name; render "Demo2", not the email. */}
                  <td className="py-2 pe-3">
                    <bdi dir="auto">{p.ownerName !== null ? formatUserName(p.ownerName) : "-"}</bdi>
                  </td>
                  <td className="py-2 text-end">
                    {p.isPrimary && !p.isExplicit ? (
                      <span className="text-xs text-muted-foreground">
                        {translateSales("deal_contact_3fdd2")}
                      </span>
                    ) : (
                      <button
                        type="button"
                        aria-label={translateSales("remove_arg0_6a983", { arg0: p.name })}
                        onClick={() => void remove(p.personId).then(setRemoveError)}
                        className="rounded p-1 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {participants.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-4 text-center text-muted-foreground">
                    {translateSales("no_participants_yet_8987d")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  );
}
