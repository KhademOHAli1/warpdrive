"use client";
import type React from "react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import type { BoardEmptyKind } from "./boardEmptyKind";

interface BoardEmptyProps {
  kind: Exclude<BoardEmptyKind, "none">;
  onClearFilters: () => void;
  // The toolbar's own add-deal control, so the empty pipeline offers the same button rather than a
  // second, different one.
  addSlot: React.ReactNode;
}

// The board with nothing on it. Which sentence is true depends on why it is empty, so a filter
// that excluded everything never reads as an empty pipeline, and a state that could be either
// claims neither and offers both ways out.
export function BoardEmpty({ kind, onClearFilters, addSlot }: BoardEmptyProps): React.ReactNode {
  const translateSales = useAppTranslations("sales");
  const clearFilters = (
    <Button size="sm" variant="outline" onClick={onClearFilters}>
      {translateSales("computed.clearFilters")}
    </Button>
  );

  if (kind === "filtered") {
    return (
      <EmptyState
        title={translateSales("computed.boardEmptyFilteredTitle")}
        body={translateSales("computed.boardEmptyFilteredBody")}
        action={clearFilters}
      />
    );
  }
  if (kind === "unsure") {
    return (
      <EmptyState
        title={translateSales("computed.boardEmptyUnsureTitle")}
        body={translateSales("computed.boardEmptyUnsureBody")}
        action={
          <div className="flex items-center gap-2">
            {clearFilters}
            {addSlot}
          </div>
        }
      />
    );
  }
  return (
    <EmptyState
      title={translateSales("computed.boardEmptyTitle")}
      body={translateSales("computed.boardEmptyBody")}
      action={addSlot}
    />
  );
}
