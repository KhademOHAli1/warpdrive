"use client";
import type React from "react";
import { Avatar } from "@/components/ui/Avatar";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import {
  DeleteSavedFilterItem,
  type PendingFilterDelete,
} from "@/features/saved-filters/SavedFilterDelete";
import { cn } from "@/lib/utils";
import type { SavedFilterView as SavedFilter } from "./savedFilterView";

export function OwnerRow({
  name,
  selected,
  isCurrentUser = false,
  onClick,
}: {
  name: string;
  selected: boolean;
  // Marks the row for the signed-in user so it reads as "Name (my)" (Pipedrive convention).
  isCurrentUser?: boolean;
  onClick: () => void;
}): React.ReactNode {
  const translateSales = useAppTranslations("sales");

  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent",
          selected && "bg-accent font-medium",
        )}
      >
        <Avatar name={name} className="h-5 w-5 text-[10px]" />
        <span className="truncate">
          <bdi dir="auto">{name}</bdi>
        </span>
        {isCurrentUser && (
          <span className="shrink-0 text-muted-foreground">{translateSales("my_af88e")}</span>
        )}
      </button>
    </li>
  );
}

// One saved filter in the Filter menu: the name picks it, the star toggles the favourite and the
// bin asks to delete it.
export function SavedFilterItem({
  filter,
  selected,
  onPick,
  onToggleFavorite,
  onRequestDelete,
}: {
  filter: SavedFilter;
  selected: boolean;
  onPick: () => void;
  onToggleFavorite?: (id: string) => void;
  onRequestDelete?: (target: PendingFilterDelete) => void;
}): React.ReactNode {
  const translateSales = useAppTranslations("sales");

  return (
    <div className="flex items-center">
      <DropdownMenuItem
        aria-current={selected ? "true" : undefined}
        onSelect={onPick}
        className={cn("min-w-0 flex-1", selected && "bg-accent font-medium")}
      >
        <span className="truncate">
          <bdi dir="auto">{filter.name}</bdi>
        </span>
      </DropdownMenuItem>
      {/* Only the owner can toggle the favorite (it is a per-row, owner-scoped flag) or delete the
          row, so both controls are shown only for owned filters. */}
      {filter.isOwn && (
        <DropdownMenuItem
          aria-label={
            filter.favorite
              ? translateSales("unfavorite_filter_03222")
              : translateSales("favorite_filter_3da9a")
          }
          aria-pressed={filter.favorite}
          // Starring is not picking, so the menu stays open.
          onSelect={(e) => {
            e.preventDefault();
            onToggleFavorite?.(filter.id);
          }}
          className="shrink-0 px-1.5 text-muted-foreground"
        >
          <span aria-hidden="true">{filter.favorite ? "★" : "☆"}</span>
        </DropdownMenuItem>
      )}
      {filter.isOwn && onRequestDelete !== undefined && (
        <DeleteSavedFilterItem
          target={{ id: filter.id, name: filter.name, isShared: filter.isShared }}
          onRequest={onRequestDelete}
        />
      )}
    </div>
  );
}
