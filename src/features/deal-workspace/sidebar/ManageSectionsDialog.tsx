"use client";
import { DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type {
  DealSidebarSectionId,
  DealSidebarSectionPreference,
} from "@/constants/dealSidebarSections";
import { sectionName } from "@/constants/dealSidebarSections";
import { useDealActionError } from "@/features/deal-workspace/DealActionErrorProvider";
import { useSalesStrings } from "@/features/deals/useSalesStrings";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { setSidebarSectionsAction } from "@/features/identity/preferencesActions";
import { readCsrfToken } from "@/utils/csrfCookie";

export interface ManageSectionsDialogProps {
  open: boolean;
  sections: DealSidebarSectionPreference[];
  onOpenChange: (open: boolean) => void;
  onSaved: (sections: DealSidebarSectionPreference[]) => void;
}

function SectionRow({
  section,
  index,
  count,
  onMove,
  onToggle,
}: {
  section: DealSidebarSectionPreference;
  index: number;
  count: number;
  onMove: (id: DealSidebarSectionId, dir: -1 | 1) => void;
  onToggle: (id: DealSidebarSectionId) => void;
}) {
  const translateSales = useAppTranslations("sales");

  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: section.id,
  });
  const name = sectionName(section.id);
  // Summary is non-hideable (it hosts the manage-sections trigger); lock its visibility toggle.
  const locked = section.id === "summary";
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent"
    >
      <button
        type="button"
        aria-label={translateSales("reorder_arg0_1071b", { arg0: name })}
        className="cursor-grab text-muted-foreground"
        {...attributes}
        {...listeners}
      >
        <GripVertical aria-hidden="true" className="h-4 w-4" />
      </button>
      <Checkbox
        checked={section.visible}
        disabled={locked}
        onCheckedChange={() => onToggle(section.id)}
        label={
          locked
            ? translateSales("arg0_always_shown_a46a1", { arg0: name })
            : translateSales("show_arg0_56cd8", { arg0: name })
        }
      />
      <span className="min-w-0 flex-1 text-sm">
        <bdi dir="auto">{name}</bdi>
      </span>
      <button
        type="button"
        aria-label={translateSales("move_arg0_up_0da0b", { arg0: name })}
        disabled={index === 0}
        onClick={() => onMove(section.id, -1)}
        className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-40"
      >
        {translateSales("up_55490")}
      </button>
      <button
        type="button"
        aria-label={translateSales("move_arg0_down_af5e1", { arg0: name })}
        disabled={index === count - 1}
        onClick={() => onMove(section.id, 1)}
        className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-40"
      >
        {translateSales("down_b86d1")}
      </button>
    </div>
  );
}

export function ManageSectionsDialog({
  open,
  sections,
  onOpenChange,
  onSaved,
}: ManageSectionsDialogProps): React.ReactNode {
  const STRINGS = useSalesStrings();

  const [draft, setDraft] = useState(sections);
  const reportError = useDealActionError();
  const sensors = useSensors(useSensor(PointerSensor));

  // Re-seed the draft when the dialog opens, and when the saved sections change beneath it.
  // Adjusting during render avoids the stale-then-correct double render an effect would cause.
  const [seen, setSeen] = useState({ open, sections });
  if (seen.open !== open || seen.sections !== sections) {
    setSeen({ open, sections });
    if (open) setDraft(sections);
  }

  function onDragEnd(event: DragEndEvent): void {
    const from = draft.findIndex((section) => section.id === event.active.id);
    const to = draft.findIndex((section) => section.id === event.over?.id);
    if (from !== -1 && to !== -1 && from !== to)
      setDraft((current) => arrayMove(current, from, to));
  }

  function move(id: DealSidebarSectionId, dir: -1 | 1): void {
    setDraft((current) => {
      const from = current.findIndex((section) => section.id === id);
      const to = from + dir;
      return from === -1 || to < 0 || to >= current.length ? current : arrayMove(current, from, to);
    });
  }

  function toggle(id: DealSidebarSectionId): void {
    if (id === "summary") return; // non-hideable: it hosts the manage-sections trigger
    setDraft((current) =>
      current.map((section) =>
        section.id === id ? { ...section, visible: !section.visible } : section,
      ),
    );
  }

  async function save(): Promise<void> {
    const result = await setSidebarSectionsAction({ sections: draft }, readCsrfToken());
    if (result.ok) {
      onSaved(draft);
      onOpenChange(false);
    } else {
      reportError(result.error.id);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{STRINGS.dealSidebar.menu.manageSections}</DialogTitle>
        </DialogHeader>
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          <SortableContext
            items={draft.map((section) => section.id)}
            strategy={verticalListSortingStrategy}
          >
            {draft.map((section, index) => (
              <SectionRow
                key={section.id}
                section={section}
                index={index}
                count={draft.length}
                onMove={move}
                onToggle={toggle}
              />
            ))}
          </SortableContext>
        </DndContext>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {STRINGS.dealSidebar.orgDialog.cancel}
          </Button>
          <Button onClick={() => void save()}>{STRINGS.dealSidebar.orgDialog.save}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
