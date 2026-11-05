"use client";
import { Button } from "@/components/ui/Button";
import { ChoiceField } from "@/features/company-profile/ui/Fields";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { formatDateOnly } from "@/lib/localeFormatting";
import type { WorkItem, WorkType } from "../contracts";
import { useWorkMessages } from "../messages";

function RecordCard({
  item,
  type,
  edit,
  move,
  disabled,
  canMove,
}: {
  item: WorkItem;
  type: WorkType | undefined;
  edit: () => void;
  move: (stageId: string) => void;
  disabled: boolean;
  canMove: boolean;
}) {
  const m = useWorkMessages();
  const locale = useLocalePreferences();
  return (
    <article className="space-y-3 rounded-md border bg-card p-4 shadow-sm">
      <Button
        variant="ghost"
        className="h-auto w-full justify-start whitespace-normal px-0 text-start font-medium"
        disabled={disabled}
        onClick={edit}
      >
        {item.title}
      </Button>
      <p className="line-clamp-2 text-sm text-muted-foreground">{item.description}</p>
      {item.dueDate !== null ? (
        <p className="text-xs">
          <span>{m.dueDate}: </span>
          <bdi>{formatDateOnly(item.dueDate, locale)}</bdi>
        </p>
      ) : null}
      <ChoiceField
        label={`${m.stage}: ${item.title}`}
        value={item.stageId}
        options={
          type?.stages
            .filter((stage) => !stage.isArchived || stage.id === item.stageId)
            .map((stage) => ({ value: stage.id, label: stage.name })) ?? []
        }
        onChange={move}
        disabled={disabled || !canMove || item.isArchived}
      />
    </article>
  );
}
export function WorkRecords({
  items,
  types,
  typeId,
  board,
  edit,
  move,
  disabled,
  canMove,
}: {
  items: WorkItem[];
  types: WorkType[];
  typeId: string;
  board: boolean;
  edit: (item: WorkItem) => void;
  move: (item: WorkItem, stageId: string) => void;
  disabled: boolean;
  canMove: boolean;
}) {
  const m = useWorkMessages();
  const selectedTypes = typeId
    ? types.filter((type) => type.id === typeId)
    : types.filter((type) => items.some((item) => item.typeId === type.id));
  const card = (item: WorkItem) => (
    <RecordCard
      key={item.id}
      item={item}
      type={types.find((type) => type.id === item.typeId)}
      edit={() => edit(item)}
      move={(stageId) => move(item, stageId)}
      disabled={disabled}
      canMove={canMove}
    />
  );
  if (items.length === 0)
    return <p className="rounded-lg border p-6 text-sm text-muted-foreground">{m.noItems}</p>;
  if (!board)
    return (
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.id}>{card(item)}</li>
        ))}
      </ul>
    );
  return (
    <div className="space-y-6">
      {selectedTypes.map((type) => (
        <section key={type.id} className="space-y-3">
          <h2 className="font-semibold">{type.name}</h2>
          <div className="flex gap-4 overflow-x-auto pb-3">
            {type.stages
              .filter(
                (stage) => !stage.isArchived || items.some((item) => item.stageId === stage.id),
              )
              .map((stage) => (
                <section
                  key={stage.id}
                  className="w-72 shrink-0 space-y-3 rounded-lg bg-muted/30 p-3"
                >
                  <h3 className="flex justify-between gap-2 text-sm font-medium">
                    <span>{stage.name}</span>
                    <span>{items.filter((item) => item.stageId === stage.id).length}</span>
                  </h3>
                  {items.filter((item) => item.stageId === stage.id).map(card)}
                </section>
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}
