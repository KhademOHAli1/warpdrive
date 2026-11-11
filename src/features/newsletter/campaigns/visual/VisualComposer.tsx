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
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, GripVertical, Trash2 } from "lucide-react";
import { useId } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { useLocale } from "@/features/i18n/LocaleProvider";
import {
  type BlockType,
  blockTypes,
  maxVisualBlocks,
  renderVisualBlocks,
  serializeVisualBlocks,
  type VisualBlock,
} from "./blocks";

const messages = {
  en: {
    heading: "Heading",
    paragraph: "Paragraph",
    button: "Button",
    image: "Image",
    divider: "Divider",
    move: "Move block",
    up: "Move up",
    down: "Move down",
    remove: "Remove block",
    url: "HTTPS URL",
    alt: "Alternative text",
    unsubscribe: "Unsubscribe",
    canvas: "Message blocks",
  },
  de: {
    heading: "Überschrift",
    paragraph: "Absatz",
    button: "Schaltfläche",
    image: "Bild",
    divider: "Trennlinie",
    move: "Block verschieben",
    up: "Nach oben",
    down: "Nach unten",
    remove: "Block entfernen",
    url: "HTTPS-URL",
    alt: "Alternativtext",
    unsubscribe: "Abbestellen",
    canvas: "Nachrichtenblöcke",
  },
  fa: {
    heading: "عنوان",
    paragraph: "پاراگراف",
    button: "دکمه",
    image: "تصویر",
    divider: "جداکننده",
    move: "جابجایی بلوک",
    up: "انتقال به بالا",
    down: "انتقال به پایین",
    remove: "حذف بلوک",
    url: "نشانی HTTPS",
    alt: "متن جایگزین",
    unsubscribe: "لغو اشتراک",
    canvas: "بلوک‌های پیام",
  },
} as const;

type Labels = (typeof messages)[keyof typeof messages];

function BlockRow({
  block,
  index,
  total,
  labels,
  disabled,
  onChange,
  onMove,
  onRemove,
}: {
  block: VisualBlock;
  index: number;
  total: number;
  labels: Labels;
  disabled: boolean;
  onChange: (value: VisualBlock) => void;
  onMove: (index: number) => void;
  onRemove: () => void;
}) {
  const drag = useSortable({ id: block.id, disabled });
  return (
    <li
      ref={drag.setNodeRef}
      style={{ transform: CSS.Transform.toString(drag.transform), transition: drag.transition }}
      className="grid gap-2 rounded-md border bg-card p-3"
    >
      <div className="flex items-center gap-2">
        <Button
          ref={drag.setActivatorNodeRef}
          {...drag.attributes}
          {...drag.listeners}
          className="touch-none"
          variant="ghost"
          size="sm"
          aria-label={labels.move}
          disabled={disabled}
        >
          <GripVertical size={16} aria-hidden="true" />
        </Button>
        <span className="flex-1 text-sm font-medium">{labels[block.type]}</span>
        <Button
          variant="ghost"
          size="sm"
          aria-label={labels.up}
          disabled={disabled || index === 0}
          onClick={() => onMove(index - 1)}
        >
          <ArrowUp size={16} aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-label={labels.down}
          disabled={disabled || index + 1 === total}
          onClick={() => onMove(index + 1)}
        >
          <ArrowDown size={16} aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-label={labels.remove}
          disabled={disabled}
          onClick={onRemove}
        >
          <Trash2 size={16} aria-hidden="true" />
        </Button>
      </div>
      {block.type !== "divider" && (
        <Textarea
          aria-label={block.type === "image" ? labels.alt : labels[block.type]}
          placeholder={block.type === "image" ? labels.alt : labels[block.type]}
          rows={block.type === "paragraph" ? 3 : 1}
          dir="auto"
          value={block.text}
          maxLength={1500}
          readOnly={disabled}
          onChange={(event) => onChange({ ...block, text: event.target.value })}
        />
      )}
      {(block.type === "button" || block.type === "image") && (
        <Input
          aria-label={labels.url}
          placeholder={labels.url}
          type="url"
          dir="ltr"
          value={block.url}
          maxLength={1000}
          readOnly={disabled}
          onChange={(event) => onChange({ ...block, url: event.target.value })}
        />
      )}
    </li>
  );
}

export function VisualComposer({
  blocks,
  disabled,
  onChange,
}: {
  blocks: VisualBlock[];
  disabled: boolean;
  onChange: (body: string, source: string) => void;
}) {
  const labels = messages[useLocale()];
  const id = useId();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function change(next: VisualBlock[]) {
    onChange(renderVisualBlocks(next, labels.unsubscribe), serializeVisualBlocks(next));
  }
  function move(from: number, to: number) {
    if (from >= 0 && to >= 0 && to < blocks.length && from !== to)
      change(arrayMove(blocks, from, to));
  }
  function onDragEnd({ active, over }: DragEndEvent) {
    if (!disabled && over !== null) {
      move(
        blocks.findIndex((block) => block.id === active.id),
        blocks.findIndex((block) => block.id === over.id),
      );
    }
  }
  function add(type: BlockType) {
    if (disabled || blocks.length >= maxVisualBlocks) return;
    change([...blocks, { id: crypto.randomUUID(), type, text: "", url: "" }]);
  }

  return (
    <div className="grid gap-2">
      <h3 className="text-sm font-medium">{labels.canvas}</h3>
      <div className="flex flex-wrap gap-2">
        {blockTypes.map((type) => (
          <Button
            key={type}
            variant="outline"
            size="sm"
            disabled={disabled || blocks.length >= maxVisualBlocks}
            onClick={() => add(type)}
          >
            {labels[type]}
          </Button>
        ))}
      </div>
      <DndContext id={id} sensors={sensors} onDragEnd={onDragEnd}>
        <SortableContext
          items={blocks.map((block) => block.id)}
          strategy={verticalListSortingStrategy}
        >
          <ol className="grid gap-2">
            {blocks.map((block, index) => (
              <BlockRow
                key={block.id}
                block={block}
                index={index}
                total={blocks.length}
                labels={labels}
                disabled={disabled}
                onChange={(value) =>
                  change(blocks.map((item) => (item.id === value.id ? value : item)))
                }
                onMove={(to) => move(index, to)}
                onRemove={() => change(blocks.filter((item) => item.id !== block.id))}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>
    </div>
  );
}
