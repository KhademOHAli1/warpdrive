"use client";
import { Ellipsis } from "lucide-react";
import Link from "next/link";
import type React from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ICON_BUTTON } from "@/constants/formStyles";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";

interface BoardActionsMenuProps {
  pipelineId: string;
}

export function BoardActionsMenu(props: BoardActionsMenuProps): React.ReactNode {
  const translateSales = useAppTranslations("sales");

  const { pipelineId } = props;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={translateSales("board_actions_43d4e")}
        className={ICON_BUTTON}
      >
        <Ellipsis aria-hidden="true" className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        <DropdownMenuItem asChild>
          <Link href={`/pipeline/${pipelineId}/list`}>
            {translateSales("select_multiple_deals_e3337")}
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
