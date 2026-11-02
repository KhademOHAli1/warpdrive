"use client";

import { useRouter } from "next/navigation";
import type React from "react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { convertToLeadAction } from "@/features/deal-workspace/convertToLeadAction";
import { useDealActionError } from "@/features/deal-workspace/DealActionErrorProvider";
import { dealClientResult } from "@/features/deals/dealClientResult";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { readCsrfToken } from "@/utils/csrfCookie";

// Confirm dialog for "Convert to a lead". Conversion archives the deal and creates a Leads-Inbox
// lead, so it is confirmed (not one-click) via the shadcn Dialog primitive (never window.confirm).
export function ConvertToLeadDialog({
  dealId,
  expectedWriteVersion,
  open,
  onOpenChange,
}: {
  dealId: string;
  expectedWriteVersion: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): React.ReactNode {
  const translateSales = useAppTranslations("sales");

  const router = useRouter();
  const reportError = useDealActionError();
  const [pending, setPending] = useState(false);
  const [sourceVersion] = useState(expectedWriteVersion);

  async function confirm(): Promise<void> {
    setPending(true);
    const r = await dealClientResult(() =>
      convertToLeadAction({ dealId, expectedWriteVersion: sourceVersion }, readCsrfToken()),
    );
    setPending(false);
    if (r.ok) {
      onOpenChange(false);
      router.push(`/leads/${r.lead.id}`);
    } else {
      reportError(r.error.id);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{translateSales("convert_to_a_lead_5cff3")}</DialogTitle>
          <DialogDescription>
            {translateSales(
              "this_moves_the_deal_to_the_leads_inbox_as_a_new_lead_and_archives_9ec17",
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            {translateSales("cancel_19766")}
          </Button>
          <Button onClick={() => void confirm()} disabled={pending}>
            {translateSales("convert_5cd42")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
