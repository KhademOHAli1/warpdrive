"use client";
import { CheckCircle2, MoreHorizontal, RotateCcw, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { useActivitiesMessages } from "./useActivitiesMessages";

export function CalendarEventActions({
  done,
  pending,
  onManage,
}: {
  done: boolean;
  pending: boolean;
  onManage: (kind: "delete" | "complete") => void;
}): React.ReactNode {
  const t = useAppTranslations("calendar");
  const S = useActivitiesMessages();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t("editor.actions")}
        disabled={pending}
        className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      >
        <MoreHorizontal className="size-4" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        <DropdownMenuItem onSelect={() => onManage("complete")}>
          {done ? (
            <RotateCcw className="size-4" aria-hidden />
          ) : (
            <CheckCircle2 className="size-4" aria-hidden />
          )}
          {done ? S.reopen : S.markAsDone}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onSelect={() => onManage("delete")}
        >
          <Trash2 className="size-4" aria-hidden />
          {S.delete}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
