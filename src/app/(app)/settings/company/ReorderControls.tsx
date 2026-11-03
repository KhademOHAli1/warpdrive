"use client";
import { ArrowDown, ArrowUp } from "lucide-react";
import type React from "react";
import { Button } from "@/components/ui/Button";
import { Tip } from "@/components/ui/tooltip";
import { useSettingsMessages } from "@/features/identity/useSettingsMessages";

const ICON_BUTTON =
  "relative size-7 shrink-0 p-0 text-muted-foreground after:absolute after:size-10 after:content-['']";

interface ReorderControlsProps {
  itemName?: string;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

// Shared reorder affordance for compact settings rows. The visible controls stay small while the
// non-overlapping pseudo-element targets preserve a 40px hit area.
export function ReorderControls({
  itemName,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
}: ReorderControlsProps): React.ReactNode {
  const L = useSettingsMessages();
  const S = L;
  const moveUp = itemName === undefined ? S.moveUp : `${S.moveUp}: ${itemName}`;
  const moveDown = itemName === undefined ? S.moveDown : `${S.moveDown}: ${itemName}`;

  return (
    <div className="flex items-center gap-3">
      <Tip label={moveUp}>
        <Button
          variant="ghost"
          size="icon"
          className={ICON_BUTTON}
          aria-label={moveUp}
          disabled={!canMoveUp}
          onClick={onMoveUp}
        >
          <ArrowUp aria-hidden="true" className="size-4" />
        </Button>
      </Tip>
      <Tip label={moveDown}>
        <Button
          variant="ghost"
          size="icon"
          className={ICON_BUTTON}
          aria-label={moveDown}
          disabled={!canMoveDown}
          onClick={onMoveDown}
        >
          <ArrowDown aria-hidden="true" className="size-4" />
        </Button>
      </Tip>
    </div>
  );
}
