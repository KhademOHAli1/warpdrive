"use client";

import { Plus, X } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useLocale } from "@/features/i18n/LocaleProvider";
import type {
  CatalogCategory,
  CatalogParameterDefinition,
  CatalogState,
  CatalogUnit,
} from "../contracts";
import { CatalogCheckbox, CatalogEditorDialog, CatalogField, CatalogSelect } from "./CatalogFields";
import { categoryOptions, categoryTrail, unitOptions } from "./catalogDisplay";
import { type CatalogWords, catalogMessages } from "./catalogMessages";
import type { CatalogEditorProps } from "./catalogTypes";

type ParameterRow = CatalogParameterDefinition & { rowId: string };

export function CatalogCategoryEditor({
  category,
  categories,
  ...dialog
}: CatalogEditorProps & { category: CatalogCategory | null; categories: CatalogCategory[] }) {
  const locale = useLocale();
  const t = catalogMessages[locale];
  const id = useId();
  const [code, setCode] = useState(category?.code ?? "");
  const [name, setName] = useState(category?.name ?? "");
  const [parent, setParent] = useState(category?.parentId ?? "");
  const [unit, setUnit] = useState<CatalogUnit | null>(category?.defaultUnit ?? null);
  const [parameters, setParameters] = useState<ParameterRow[]>(() =>
    (category?.parameters ?? []).map((definition, index) => ({
      ...definition,
      rowId: `${id}-${index}`,
    })),
  );
  const choices = categoryOptions(
    categories.filter(
      ({ id }) =>
        category === null ||
        !categoryTrail(categories, id).some((entry) => entry.id === category.id),
    ),
    locale,
  );

  function addParameter() {
    setParameters([
      ...parameters,
      { rowId: crypto.randomUUID(), key: "", label: "", kind: "text", unit: null },
    ]);
  }

  return (
    <CatalogEditorDialog
      {...dialog}
      title={category === null ? t.addCategory : t.editCategory}
      description={t.categoryIntro}
      submit={() =>
        void dialog.save({
          type: "saveCategory",
          id: category?.id ?? null,
          code,
          name,
          parentId: parent || null,
          defaultUnit: unit,
          parameters: parameters.map(({ key, label, kind, unit }) => ({ key, label, kind, unit })),
        })
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <CatalogField id={`${id}-name`} label={t.name}>
          <Input
            id={`${id}-name`}
            required
            maxLength={100}
            disabled={dialog.pending}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </CatalogField>
        <CatalogField id={`${id}-code`} label={t.code}>
          <Input
            id={`${id}-code`}
            dir="ltr"
            required
            maxLength={40}
            disabled={dialog.pending}
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
        </CatalogField>
        <CatalogField label={t.parentCategory}>
          <CatalogSelect
            ariaLabel={t.parentCategory}
            value={parent}
            disabled={dialog.pending}
            options={[{ value: "", label: t.noParent }, ...choices]}
            onChange={setParent}
          />
        </CatalogField>
        <CatalogField label={t.defaultUnit}>
          <CatalogSelect
            ariaLabel={t.defaultUnit}
            value={unit ?? ""}
            disabled={dialog.pending}
            options={[{ value: "", label: t.inheritDefaults }, ...unitOptions(t)]}
            onChange={(value) => setUnit(value === "" ? null : (value as CatalogUnit))}
          />
        </CatalogField>
      </div>
      <fieldset className="space-y-3 rounded-md border p-3">
        <legend className="px-1 text-sm font-medium">{t.parameters}</legend>
        {parameters.map((parameter) => (
          <ParameterDefinitionRow
            key={parameter.rowId}
            t={t}
            row={parameter}
            pending={dialog.pending}
            change={(changes) =>
              setParameters(
                parameters.map((row) =>
                  row.rowId === parameter.rowId ? { ...row, ...changes } : row,
                ),
              )
            }
            remove={() =>
              setParameters(parameters.filter(({ rowId }) => rowId !== parameter.rowId))
            }
          />
        ))}
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={dialog.pending}
          onClick={addParameter}
        >
          <Plus aria-hidden="true" />
          {t.addParameter}
        </Button>
      </fieldset>
    </CatalogEditorDialog>
  );
}

function ParameterDefinitionRow({
  row,
  t,
  pending,
  change,
  remove,
}: {
  row: ParameterRow;
  t: CatalogWords;
  pending: boolean;
  change: (changes: Partial<CatalogParameterDefinition>) => void;
  remove: () => void;
}) {
  const id = useId();

  return (
    <div className="space-y-3 rounded-md border bg-background p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <CatalogField id={`${id}-key`} label={t.parameterCode}>
          <Input
            id={`${id}-key`}
            dir="ltr"
            required
            maxLength={40}
            disabled={pending}
            value={row.key}
            onChange={(event) => change({ key: event.target.value })}
          />
        </CatalogField>
        <CatalogField id={`${id}-label`} label={t.parameterName}>
          <Input
            id={`${id}-label`}
            required
            maxLength={100}
            disabled={pending}
            value={row.label}
            onChange={(event) => change({ label: event.target.value })}
          />
        </CatalogField>
        <CatalogField label={t.parameterKind}>
          <CatalogSelect
            ariaLabel={t.parameterKind}
            value={row.kind}
            disabled={pending}
            options={[
              { value: "text", label: t.text },
              { value: "number", label: t.number },
              { value: "boolean", label: t.boolean },
            ]}
            onChange={(next) =>
              change({ kind: next as CatalogParameterDefinition["kind"], unit: null })
            }
          />
        </CatalogField>
        {row.kind === "number" && (
          <CatalogField label={t.unit}>
            <CatalogSelect
              ariaLabel={t.unit}
              value={row.unit ?? ""}
              disabled={pending}
              options={[{ value: "", label: t.none }, ...unitOptions(t)]}
              onChange={(next) => change({ unit: next === "" ? null : (next as CatalogUnit) })}
            />
          </CatalogField>
        )}
      </div>
      <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={remove}>
        <X aria-hidden="true" />
        {t.removeParameter}
      </Button>
    </div>
  );
}

export function CatalogStateEditor({
  state,
  ...dialog
}: CatalogEditorProps & { state: CatalogState | null }) {
  const t = catalogMessages[useLocale()];
  const id = useId();
  const [code, setCode] = useState(state?.code ?? "");
  const [name, setName] = useState(state?.name ?? "");
  const [active, setActive] = useState(state?.active ?? true);
  const [locked, setLocked] = useState(state?.locked ?? false);

  return (
    <CatalogEditorDialog
      {...dialog}
      title={state === null ? t.addState : t.editState}
      description={t.stateIntro}
      submit={() =>
        void dialog.save({ type: "saveState", id: state?.id ?? null, code, name, active, locked })
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <CatalogField id={`${id}-state-name`} label={t.stateName}>
          <Input
            id={`${id}-state-name`}
            required
            disabled={dialog.pending}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </CatalogField>
        <CatalogField id={`${id}-state-code`} label={t.stateCode}>
          <Input
            id={`${id}-state-code`}
            dir="ltr"
            required
            disabled={dialog.pending}
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
        </CatalogField>
        <CatalogCheckbox
          id={`${id}-active`}
          label={t.active}
          checked={active}
          disabled={dialog.pending}
          change={setActive}
        />
        <CatalogCheckbox
          id={`${id}-locked`}
          label={t.locked}
          checked={locked}
          disabled={dialog.pending}
          change={setLocked}
        />
      </div>
    </CatalogEditorDialog>
  );
}
