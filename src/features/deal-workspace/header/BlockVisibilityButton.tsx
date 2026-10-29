"use client";
import { Eye } from "lucide-react";
import type React from "react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DEAL_BLOCKS, type DealBlockId } from "@/constants/dealBlocks";
import { ICON_BUTTON } from "@/constants/formStyles";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";

interface BlockVisibilityButtonProps {
  isHidden: (id: DealBlockId) => boolean;
  onToggle: (id: DealBlockId) => void;
}

// Eye + chevron button (Pipedrive block-visibility). Opens a checkbox menu, one per detail block;
// unchecking hides that section on the page. State + persistence live in useBlockVisibility.
export function BlockVisibilityButton({
  isHidden,
  onToggle,
}: BlockVisibilityButtonProps): React.ReactNode {
  const translateSales = useAppTranslations("sales");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={translateSales("toggle_detail_blocks_396e8")}
        className={ICON_BUTTON}
      >
        <Eye aria-hidden="true" className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        aria-label={translateSales("detail_blocks_25204")}
        className="min-w-44"
      >
        {DEAL_BLOCKS.map((b) => (
          <DropdownMenuCheckboxItem
            key={b.id}
            checked={!isHidden(b.id)}
            // Keep the menu open while toggling several blocks in a row.
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={() => onToggle(b.id)}
          >
            <bdi dir="auto">{b.name}</bdi>
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
