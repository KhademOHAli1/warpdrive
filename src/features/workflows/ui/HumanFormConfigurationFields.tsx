"use client";

import {
  type Announcements,
  closestCenter,
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
import { GripVertical, Plus, Settings2, Trash2, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { ToggleField } from "@/components/ui/ToggleField";
import { useAppTranslations, useLocale } from "@/features/i18n/LocaleProvider";
import { useFormatters } from "@/lib/useFormatters";
import type { ConfigurationValidation } from "../configurationTypes";
import type { WorkflowNode } from "../schemas";
import {
  type WorkflowHumanFormField,
  workflowHumanFormDraftConfig,
  workflowHumanFormLimits,
  workflowHumanFormType,
  workflowHumanFormTypes,
} from "../workflowHumanFormContract";
import { configurationIssueKeys } from "./configurationIssueMessage";
import styles from "./workflowInspector.module.css";

const copy = {
  en: {
    instructions: "Instructions",
    instructionsPlaceholder: "Tell the person filling in the form what to do.",
    empty: "Add inputs to your form",
    emptyHint: "Add a field for the person who starts the workflow to fill in.",
    useAnswers: "Later steps can use submitted answers.",
    settings: "Input settings",
    add: "Add field",
    delete: "Delete field",
    reorder: "Reorder field",
    type: "Type",
    label: "Label",
    placeholder: "Placeholder",
    required: "Required",
    types: { text: "Text", number: "Number", date: "Date" },
    prompts: { text: "Enter text", number: "Enter a number", date: "Choose a date" },
    dragHelp:
      "Press Space to pick up the field, use the arrow keys to move it, then press Space to drop it or Escape to cancel.",
    position: "Position",
    dragCancelled: "Reordering cancelled.",
  },
  de: {
    instructions: "Anweisungen",
    instructionsPlaceholder: "Erklären Sie, was beim Ausfüllen zu tun ist.",
    empty: "Eingabefelder hinzufügen",
    emptyHint: "Fügen Sie ein Feld hinzu, das die Person ausfüllt, die den Workflow startet.",
    useAnswers: "Spätere Schritte können die eingereichten Antworten verwenden.",
    settings: "Feldeinstellungen",
    add: "Feld hinzufügen",
    delete: "Feld löschen",
    reorder: "Feld verschieben",
    type: "Typ",
    label: "Bezeichnung",
    placeholder: "Platzhalter",
    required: "Pflichtfeld",
    types: { text: "Text", number: "Zahl", date: "Datum" },
    prompts: { text: "Text eingeben", number: "Zahl eingeben", date: "Datum auswählen" },
    dragHelp:
      "Drücken Sie die Leertaste, um das Feld aufzunehmen. Verschieben Sie es mit den Pfeiltasten und drücken Sie erneut die Leertaste zum Ablegen oder Escape zum Abbrechen.",
    position: "Position",
    dragCancelled: "Verschieben abgebrochen.",
  },
  fa: {
    instructions: "راهنما",
    instructionsPlaceholder: "برای تکمیل‌کنندهٔ فرم توضیح دهید چه کاری باید انجام دهد.",
    empty: "افزودن فیلد به فرم",
    emptyHint: "فیلدی اضافه کنید تا آغازکنندهٔ گردش کار آن را تکمیل کند.",
    useAnswers: "مرحله‌های بعدی می‌توانند از پاسخ‌های ثبت‌شده استفاده کنند.",
    settings: "تنظیمات فیلد",
    add: "افزودن فیلد",
    delete: "حذف فیلد",
    reorder: "جابه‌جایی فیلد",
    type: "نوع",
    label: "عنوان",
    placeholder: "متن راهنما",
    required: "الزامی",
    types: { text: "متن", number: "عدد", date: "تاریخ" },
    prompts: { text: "متن وارد کنید", number: "عدد وارد کنید", date: "تاریخ را انتخاب کنید" },
    dragHelp:
      "برای گرفتن فیلد کلید فاصله را بزنید، با کلیدهای جهت‌نما آن را جابه‌جا کنید و برای رها کردن دوباره فاصله یا برای انصراف Escape را بزنید.",
    position: "موقعیت",
    dragCancelled: "جابه‌جایی لغو شد.",
  },
};

function InputSettings({
  id,
  field,
  labelError,
  onChange,
  onClose,
}: {
  id: string;
  field: WorkflowHumanFormField;
  labelError?: string;
  onChange: (field: WorkflowHumanFormField) => void;
  onClose: () => void;
}) {
  const text = copy[useLocale()];
  const t = useAppTranslations("workflows");
  const labelRef = useRef<HTMLInputElement>(null);
  useEffect(() => labelRef.current?.focus(), []);
  return (
    <section
      id={id}
      aria-labelledby={`${id}-heading`}
      className="col-start-2 mt-3 min-w-0 rounded-lg border border-[var(--workflow-border-medium)] bg-[var(--workflow-hover-overlay)]"
    >
      <div className="flex items-center justify-between gap-2 border-b border-[var(--workflow-border-medium)] px-3 py-2">
        <h3 id={`${id}-heading`} className="flex items-center gap-1.5 font-semibold">
          <Settings2 className="size-4" aria-hidden="true" />
          {text.settings}
        </h3>
        <Button
          variant="ghost"
          size="icon"
          static
          className="size-6"
          aria-label={t("close")}
          onClick={onClose}
        >
          <X className="size-4" aria-hidden="true" />
        </Button>
      </div>
      <div className="space-y-2 p-3">
        <div className={styles.field}>
          <span className={styles.label}>{text.type}</span>
          <Select
            ariaLabel={text.type}
            value={field.type}
            options={workflowHumanFormTypes.map((type) => ({
              value: type,
              label: text.types[type],
            }))}
            onChange={(value) => {
              const next = workflowHumanFormType.safeParse(value);
              if (next.success && next.data !== field.type) {
                const { id, label, required } = field;
                onChange({ id, label, required, type: next.data });
              }
            }}
          />
        </div>
        <div className={styles.field}>
          <label htmlFor={`${id}-label`}>{text.label}</label>
          <Input
            ref={labelRef}
            id={`${id}-label`}
            dir="auto"
            value={field.label}
            maxLength={workflowHumanFormLimits.label}
            aria-invalid={labelError !== undefined}
            aria-describedby={labelError === undefined ? undefined : `${id}-label-error`}
            onChange={(event) => onChange({ ...field, label: event.currentTarget.value })}
          />
          {labelError !== undefined && (
            <p id={`${id}-label-error`} className="text-xs text-destructive">
              {labelError}
            </p>
          )}
        </div>
        {field.type !== "date" && (
          <div className={styles.field}>
            <label htmlFor={`${id}-placeholder`}>{text.placeholder}</label>
            <Input
              id={`${id}-placeholder`}
              dir="auto"
              value={field.placeholder ?? ""}
              maxLength={workflowHumanFormLimits.placeholder}
              onChange={(event) => onChange({ ...field, placeholder: event.currentTarget.value })}
            />
          </div>
        )}
        <ToggleField
          label={text.required}
          checked={field.required}
          onCheckedChange={(required) => onChange({ ...field, required })}
        />
      </div>
    </section>
  );
}

function fieldName(field: WorkflowHumanFormField, text: (typeof copy)[keyof typeof copy]): string {
  return field.label.trim() || text.types[field.type];
}

function FormFieldRow({
  field,
  open,
  editable,
  labelError,
  onSelect,
  onChange,
  onDelete,
}: {
  field: WorkflowHumanFormField;
  open: boolean;
  editable: boolean;
  labelError?: string;
  onSelect: (id: string | null) => void;
  onChange: (field: WorkflowHumanFormField) => void;
  onDelete: () => void;
}) {
  const text = copy[useLocale()];
  const settingsId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition } =
    useSortable({ id: field.id, disabled: !editable });
  const label = fieldName(field, text);
  const placeholder = field.type === "date" ? "" : (field.placeholder?.trim() ?? "");
  const preview = placeholder === "" ? text.prompts[field.type] : placeholder;
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className="grid grid-cols-[24px_minmax(0,1fr)_24px] items-end gap-x-1"
    >
      {editable && (
        <Button
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          variant="ghost"
          size="icon"
          static
          className="size-6 touch-none cursor-grab"
          aria-label={`${text.reorder}: ${label}`}
        >
          <GripVertical className="size-4" aria-hidden="true" />
        </Button>
      )}
      <div className="col-start-2 min-w-0 space-y-1">
        <p className={styles.label} dir="auto">
          {label}
          {field.required ? " *" : ""}
        </p>
        {editable ? (
          <Button
            ref={trigger}
            variant="outline"
            size="sm"
            className="h-8 w-full justify-start truncate px-2 font-normal text-muted-foreground"
            aria-label={`${text.settings}: ${label}`}
            aria-expanded={open}
            aria-controls={open ? settingsId : undefined}
            onClick={() => onSelect(open ? null : field.id)}
          >
            <bdi className="truncate">{preview}</bdi>
          </Button>
        ) : (
          <div className="flex h-8 min-w-0 items-center rounded-lg border border-[var(--workflow-border-medium)] px-2 text-muted-foreground">
            <bdi className="truncate">{preview}</bdi>
          </div>
        )}
      </div>
      {editable && (
        <Button
          variant="ghost"
          size="icon"
          static
          className="size-6"
          aria-label={`${text.delete}: ${label}`}
          onClick={onDelete}
        >
          <Trash2 className="size-4" aria-hidden="true" />
        </Button>
      )}
      {editable && open && (
        <InputSettings
          id={settingsId}
          field={field}
          labelError={labelError}
          onChange={onChange}
          onClose={() => {
            onSelect(null);
            trigger.current?.focus();
          }}
        />
      )}
    </li>
  );
}

export function HumanFormConfigurationFields({
  node,
  editable,
  onChange,
  validation,
}: {
  node: WorkflowNode;
  editable: boolean;
  onChange: (node: WorkflowNode) => void;
  validation: ConfigurationValidation;
}) {
  const text = copy[useLocale()];
  const t = useAppTranslations("workflows");
  const format = useFormatters();
  const instructionsId = useId();
  const addButton = useRef<HTMLButtonElement>(null);
  const [selection, setSelection] = useState<{ nodeId: string; fieldId: string } | null>(null);
  const selected = selection?.nodeId === node.id ? selection.fieldId : null;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const config = workflowHumanFormDraftConfig.safeParse(node.config);
  if (!config.success) return <p role="alert">{t("invalid")}</p>;
  const { fields, instructions } = config.data;

  function patchDraft(nextFields: WorkflowHumanFormField[], nextInstructions = instructions) {
    if (!editable) return;
    onChange({
      ...node,
      config: {
        fields: nextFields,
        ...(nextInstructions === undefined ? {} : { instructions: nextInstructions }),
      },
    });
  }
  function select(fieldId: string | null) {
    setSelection(fieldId === null ? null : { nodeId: node.id, fieldId });
  }
  function add() {
    if (!editable || fields.length >= workflowHumanFormLimits.fields) return;
    const id = crypto.randomUUID();
    const label = fields.some(
      (field) => field.label.trim().toLowerCase() === text.types.text.toLowerCase(),
    )
      ? ""
      : text.types.text;
    patchDraft([...fields, { id, type: "text", label, required: true }]);
    select(id);
  }
  function reorder({ active, over }: DragEndEvent) {
    if (over === null || active.id === over.id) return;
    const from = fields.findIndex(({ id }) => id === active.id);
    const to = fields.findIndex(({ id }) => id === over.id);
    if (from >= 0 && to >= 0) patchDraft(arrayMove(fields, from, to));
  }
  function position(id: string | number) {
    return `${text.position} ${format.number(fields.findIndex((field) => field.id === id) + 1)}`;
  }
  const announcements: Announcements = {
    onDragStart: ({ active }) => position(active.id),
    onDragOver: ({ over }) => (over === null ? undefined : position(over.id)),
    onDragEnd: ({ over }) => (over === null ? text.dragCancelled : position(over.id)),
    onDragCancel: () => text.dragCancelled,
  };
  return (
    <div className="space-y-4">
      <div className={styles.field}>
        <label htmlFor={instructionsId}>{text.instructions}</label>
        <Textarea
          id={instructionsId}
          dir="auto"
          value={instructions ?? ""}
          disabled={!editable}
          placeholder={text.instructionsPlaceholder}
          maxLength={workflowHumanFormLimits.instructions}
          onChange={(event) => patchDraft(fields, event.currentTarget.value)}
        />
        <p className={styles.hint}>{text.useAnswers}</p>
      </div>
      {fields.length === 0 && (
        <div className="rounded-lg border border-[var(--workflow-border-medium)] bg-[var(--workflow-hover-overlay)] p-3">
          <p className="font-semibold">{text.empty}</p>
          <p className={styles.hint}>{text.emptyHint}</p>
        </div>
      )}
      <DndContext
        id={instructionsId}
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={reorder}
        accessibility={{ announcements, screenReaderInstructions: { draggable: text.dragHelp } }}
      >
        <SortableContext items={fields.map(({ id }) => id)} strategy={verticalListSortingStrategy}>
          <ol className="space-y-4">
            {fields.map((field, index) => {
              const issue = validation.issues.find(
                ({ path }) =>
                  path[0] === "fields" && path[1] === String(index) && path[2] === "label",
              );
              return (
                <FormFieldRow
                  key={field.id}
                  field={field}
                  open={selected === field.id}
                  editable={editable}
                  labelError={
                    issue === undefined ? undefined : t(configurationIssueKeys[issue.code])
                  }
                  onSelect={select}
                  onChange={(next) =>
                    patchDraft(fields.map((row) => (row.id === field.id ? next : row)))
                  }
                  onDelete={() => {
                    patchDraft(fields.filter((row) => row.id !== field.id));
                    if (selected === field.id) select(null);
                    requestAnimationFrame(() => addButton.current?.focus());
                  }}
                />
              );
            })}
          </ol>
        </SortableContext>
      </DndContext>
      {editable && (
        <Button
          ref={addButton}
          variant="outline"
          size="sm"
          className="mx-auto flex h-8 w-[calc(100%-56px)]"
          disabled={fields.length >= workflowHumanFormLimits.fields}
          onClick={add}
        >
          <Plus className="size-4" aria-hidden="true" />
          {text.add}
        </Button>
      )}
    </div>
  );
}
