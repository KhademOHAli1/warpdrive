"use client";
import { Ellipsis } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";

// "More actions" overflow for an activity card: Edit, the done/reopen toggle, and a
// confirmed Delete. Split out of ActivityCard so the card stays within the file budget.
export function ActivityCardMenu({
  done,
  busy,
  onEdit,
  onToggle,
  onDelete,
}: {
  done: boolean;
  busy: boolean;
  onEdit?: () => void;
  onToggle: () => void;
  onDelete: () => void;
}): React.ReactNode {
  const translateSales = useAppTranslations("sales");

  const [confirmingDelete, setConfirmingDelete] = useState(false);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={translateSales("more_actions_f8d46")}
        // Pseudo-element extends the 24px control to a ~40px hit target without changing layout.
        className="relative rounded p-1 text-muted-foreground after:absolute after:-inset-2 after:content-[''] hover:bg-accent hover:text-foreground"
      >
        <Ellipsis aria-hidden="true" className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        aria-label={translateSales("more_actions_f8d46")}
        className="min-w-40"
      >
        {onEdit !== undefined && (
          <DropdownMenuItem onSelect={() => onEdit()}>
            {translateSales("edit_464c4")}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={onToggle}>
          {done ? translateSales("reopen_a886d") : translateSales("mark_as_done_62aa4")}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => setConfirmingDelete(true)}
          className="text-destructive focus:text-destructive"
        >
          {translateSales("delete_e2d0a")}
        </DropdownMenuItem>
      </DropdownMenuContent>

      {/* Sibling of the menu content, not a child: the menu unmounts its items on select,
          which would take the dialog with it. */}
      <ConfirmDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title={translateSales("delete_activity_88be8")}
        description={translateSales("this_cannot_be_undone_b545d")}
        confirmLabel={translateSales("delete_e2d0a")}
        destructive
        pending={busy}
        onConfirm={onDelete}
      />
    </DropdownMenu>
  );
}
