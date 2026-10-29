"use client";
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type React from "react";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import type { ColumnDef } from "./columnModel";
import { SortableColumnRow } from "./SortableColumnRow";

export interface ColumnsMenuSortableListProps {
  catalog: readonly ColumnDef[];
  order: readonly string[];
  pinned: string | undefined;
  onToggle: (key: string) => void;
  onReorder: (from: string, to: string) => void;
}

// The drag-reorderable half of ColumnsMenu. Split out so dnd-kit is reachable only from here:
// ColumnsMenu loads it through next/dynamic, keeping dnd-kit out of the People, Orgs and Deals
// list bundles, which otherwise paid for it just to render a cog button.
export function ColumnsMenuSortableList({
  catalog,
  order,
  pinned,
  onToggle,
  onReorder,
}: ColumnsMenuSortableListProps): React.ReactNode {
  const t = useAppTranslations("tableControls");
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const byKey = new Map(catalog.map((c) => [c.key, c]));

  function onDragEnd(e: DragEndEvent): void {
    const from = String(e.active.id);
    const to = e.over === null ? from : String(e.over.id);
    if (from !== to) onReorder(from, to);
  }

  const nameFor = (id: string | number) => byKey.get(String(id))?.header ?? t("column");
  const positionFor = (id: string | number) => Math.max(1, order.indexOf(String(id)) + 1);
  const accessibility = {
    screenReaderInstructions: { draggable: t("dragInstructions") },
    announcements: {
      onDragStart: ({ active }: { active: { id: string | number } }) =>
        t("columnPickedUp", { name: nameFor(active.id) }),
      onDragOver: ({
        active,
        over,
      }: {
        active: { id: string | number };
        over: { id: string | number } | null;
      }) =>
        over === null
          ? undefined
          : t("columnMoved", {
              name: nameFor(active.id),
              position: positionFor(over.id),
              total: order.length,
            }),
      onDragEnd: ({
        active,
        over,
      }: {
        active: { id: string | number };
        over: { id: string | number } | null;
      }) =>
        over === null
          ? t("columnDragCancelled", { name: nameFor(active.id) })
          : t("columnDropped", {
              name: nameFor(active.id),
              position: positionFor(over.id),
              total: order.length,
            }),
      onDragCancel: ({ active }: { active: { id: string | number } }) =>
        t("columnDragCancelled", { name: nameFor(active.id) }),
    },
  };
  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd} accessibility={accessibility}>
      <SortableContext items={[...order]} strategy={verticalListSortingStrategy}>
        {order.map((key) => {
          const col = byKey.get(key);
          return col === undefined ? null : (
            <SortableColumnRow key={key} col={col} pinned={key === pinned} onToggle={onToggle} />
          );
        })}
      </SortableContext>
    </DndContext>
  );
}
