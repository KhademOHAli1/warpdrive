"use client";
import { EllipsisVertical } from "lucide-react";
import { useRouter } from "next/navigation";
import type React from "react";
import { useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ICON_BUTTON } from "@/constants/formStyles";
import { deleteDealAction } from "@/features/deal-workspace/actions";
import { useDealActionError } from "@/features/deal-workspace/DealActionErrorProvider";
import { duplicateDealAction } from "@/features/deal-workspace/duplicateDealAction";
import { archiveDealAction } from "@/features/deals/archiveActions";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { useDetailDrawerClose } from "@/features/navigation/detailDrawerClose";
import { readCsrfToken } from "@/utils/csrfCookie";
import { ConvertToLeadDialog } from "./ConvertToLeadDialog";
import { MergeDealDialog } from "./MergeDealDialog";

// Which confirm flow (its own Dialog) is currently open, if any.
type Flow = "convert" | "merge" | "delete" | null;

interface DealActionsMenuProps {
  dealId: string;
  // The deal's pipeline: scopes the merge picker to same-pipeline candidates.
  pipelineId: string;
  // CAS precondition for delete: the deal's updatedAt ISO string.
  expectedUpdatedAt: string;
  // Whether the actor holds deal.delete (own/any) for this deal. Server-enforced in deleteDeal;
  // this only hides the item so a user without the capability is not offered an action that 403s.
  canDelete: boolean;
}

// Overflow (ellipsis) menu for deal-level actions (Pipedrive parity): Copy link, Duplicate,
// Convert to a lead, Merge, Archive, Delete deal. Each item is backed by a real, permission-gated
// action; the destructive Convert/Merge/Delete flows confirm before firing.
export function DealActionsMenu({
  dealId,
  pipelineId,
  expectedUpdatedAt,
  canDelete,
}: DealActionsMenuProps): React.ReactNode {
  const translateSales = useAppTranslations("sales");

  const router = useRouter();
  const reportError = useDealActionError();
  const closeDrawer = useDetailDrawerClose();
  const [pending, setPending] = useState(false);
  const [flow, setFlow] = useState<Flow>(null);

  async function copyLink(): Promise<void> {
    await navigator.clipboard.writeText(`${location.origin}/deals/${dealId}`);
  }

  async function duplicate(): Promise<void> {
    setPending(true);
    const r = await duplicateDealAction({ dealId }, readCsrfToken());
    setPending(false);
    if (r.ok) router.push(`/deals/${r.deal.id}`);
    else reportError(r.error.id);
  }

  async function archive(): Promise<void> {
    setPending(true);
    const r = await archiveDealAction({ dealId, archived: true }, readCsrfToken());
    setPending(false);
    if (r.ok) router.refresh();
    else reportError(r.error.id);
  }

  async function remove(): Promise<void> {
    setPending(true);
    const r = await deleteDealAction({ dealId, expectedUpdatedAt }, readCsrfToken());
    setPending(false);
    if (!r.ok) {
      reportError(r.error.id);
      return;
    }
    // Opened as a slide-over, the deal has a list behind it to return to, and pushing would be a
    // soft navigation that leaves the slot rendering the deal just deleted.
    if (closeDrawer !== null) closeDrawer();
    else router.push("/pipeline");
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={translateSales("deal_actions_d9823")}
        disabled={pending}
        className={ICON_BUTTON}
      >
        <EllipsisVertical aria-hidden="true" className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuItem onSelect={() => void copyLink()}>
          {translateSales("copy_link_dbf36")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void duplicate()}>
          {translateSales("duplicate_02cda")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setFlow("convert")}>
          {translateSales("convert_to_a_lead_5cff3")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setFlow("merge")}>
          {translateSales("merge_8851a")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void archive()}>
          {translateSales("archive_66f48")}
        </DropdownMenuItem>
        {canDelete && (
          <DropdownMenuItem onSelect={() => setFlow("delete")} className="text-destructive">
            {translateSales("delete_deal_0e193")}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>

      {/* Mount each flow only while active: MergeDealDialog issues a tRPC query on render, so
          keeping it unmounted until opened avoids requiring a tRPC provider just to show the menu. */}
      {flow === "convert" && (
        <ConvertToLeadDialog
          dealId={dealId}
          expectedUpdatedAt={expectedUpdatedAt}
          open
          onOpenChange={(o) => {
            if (!o) setFlow(null);
          }}
        />
      )}
      {flow === "merge" && (
        <MergeDealDialog
          dealId={dealId}
          pipelineId={pipelineId}
          expectedUpdatedAt={expectedUpdatedAt}
          open
          onOpenChange={(o) => {
            if (!o) setFlow(null);
          }}
        />
      )}
      <ConfirmDialog
        open={flow === "delete"}
        onOpenChange={(o) => {
          if (!o) setFlow(null);
        }}
        title={translateSales("delete_this_deal_5da3f")}
        description={translateSales(
          "this_cannot_be_undone_the_deal_and_its_activity_are_removed_for_e_7d528",
        )}
        confirmLabel={translateSales("delete_e2d0a")}
        destructive
        pending={pending}
        onConfirm={() => void remove()}
      />
    </DropdownMenu>
  );
}
