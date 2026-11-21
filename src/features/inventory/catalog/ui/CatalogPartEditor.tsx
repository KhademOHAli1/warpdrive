"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { useLocale } from "@/features/i18n/LocaleProvider";
import {
  blankCatalogProfile,
  type CatalogParameterDefinition,
  type CatalogParameterValue,
  type CatalogPart,
  type CatalogProfile,
  type CatalogUnit,
  type CatalogWorkspace,
  compatibleCatalogUnits,
} from "../contracts";
import { CatalogCheckbox, CatalogEditorDialog, CatalogField, CatalogSelect } from "./CatalogFields";
import {
  applicableParameters,
  catalogFlagKeys,
  catalogPartLabel,
  categoryOptions,
  categoryTrail,
  unitOptions,
} from "./catalogDisplay";
import { type CatalogWords, catalogMessages } from "./catalogMessages";
import type { CatalogEditorProps } from "./catalogTypes";

export type PartTarget =
  | { mode: "create" }
  | { mode: "edit" | "variant" | "revision"; part: CatalogPart };
type PartDraft = {
  id: string | null;
  code: string;
  name: string;
  revision: string;
  kind: CatalogPart["kind"];
  profile: CatalogProfile;
};

function initialDraft(target: PartTarget): PartDraft {
  if (target.mode === "create")
    return {
      id: null,
      code: "",
      name: "",
      revision: "A",
      kind: "component",
      profile: blankCatalogProfile("component"),
    };

  const { part, mode } = target;
  const profile = { ...part.profile };
  if (mode === "edit") {
    return {
      id: part.id,
      code: part.code,
      name: part.name,
      revision: part.revision,
      kind: part.kind,
      profile,
    };
  }
  profile.version = 0;
  profile.stateId = null;
  if (mode === "variant") {
    profile.templateItemId = part.id;
    profile.isTemplate = false;
    profile.supersedesItemId = null;
    return { id: null, code: "", name: "", revision: "A", kind: part.kind, profile };
  }
  profile.supersedesItemId = part.id;
  return { id: null, code: part.code, name: part.name, revision: "", kind: part.kind, profile };
}

export function CatalogPartEditor({
  workspace,
  target,
  initialCategoryId,
  ...dialog
}: CatalogEditorProps & {
  workspace: CatalogWorkspace;
  target: PartTarget;
  initialCategoryId: string | null;
}) {
  const locale = useLocale();
  const t = catalogMessages[locale];
  const id = useId();
  const [draft, setDraft] = useState(() => {
    const initial = initialDraft(target);
    if (target.mode !== "create" || initialCategoryId === null) return initial;
    const trail = categoryTrail(workspace.categories, initialCategoryId);
    const unit =
      trail.reverse().find((entry) => entry.defaultUnit !== null)?.defaultUnit ??
      initial.profile.unit;
    return { ...initial, profile: { ...initial.profile, categoryId: initialCategoryId, unit } };
  });
  const [tags, setTags] = useState(draft.profile.tags.join(", "));
  const { pending } = dialog;
  const { mode } = target;
  const profiles = applicableParameters(workspace.categories, draft.profile.categoryId);
  const canChangeIdentity = mode === "create" || mode === "variant";
  const hasSource = mode === "variant" || mode === "revision";
  const partTitles = {
    create: t.addPart,
    edit: t.editPart,
    variant: t.addVariant,
    revision: t.addRevision,
  };

  function setProfile(delta: Partial<CatalogProfile>) {
    setDraft((current) => ({ ...current, profile: { ...current.profile, ...delta } }));
  }

  function setCategory(categoryId: string | null) {
    const definitions = applicableParameters(workspace.categories, categoryId);
    const unit = categoryTrail(workspace.categories, categoryId)
      .reverse()
      .find((entry) => entry.defaultUnit !== null)?.defaultUnit;
    setProfile({
      categoryId,
      unit: (mode === "create" ? unit : null) ?? draft.profile.unit,
      values: draft.profile.values.filter(({ key }) =>
        definitions.some((definition) => definition.key === key),
      ),
    });
  }

  function setParameter(key: string, value: CatalogParameterValue | null) {
    const values = draft.profile.values.filter((entry) => entry.key !== key);
    setProfile({ values: value === null ? values : [...values, value] });
  }

  function savePart() {
    void dialog.save({
      type: "savePart",
      ...draft,
      profile: {
        ...draft.profile,
        tags: [
          ...new Set(
            tags
              .split(",")
              .map((tag) => tag.trim())
              .filter(Boolean),
          ),
        ],
      },
    });
  }

  return (
    <CatalogEditorDialog
      {...dialog}
      title={partTitles[mode]}
      description={t.baseline}
      submit={savePart}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <CatalogField id={`${id}-code`} label={t.partNumber}>
          <Input
            id={`${id}-code`}
            dir="ltr"
            required
            disabled={pending}
            readOnly={!canChangeIdentity}
            maxLength={40}
            value={draft.code}
            onChange={(event) => setDraft({ ...draft, code: event.target.value })}
          />
        </CatalogField>
        <CatalogField id={`${id}-name`} label={t.name}>
          <Input
            id={`${id}-name`}
            required
            disabled={pending}
            maxLength={120}
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          />
        </CatalogField>
        <CatalogField id={`${id}-revision`} label={t.revision}>
          <Input
            id={`${id}-revision`}
            dir="ltr"
            required
            disabled={pending}
            readOnly={mode === "edit"}
            maxLength={20}
            value={draft.revision}
            onChange={(event) => setDraft({ ...draft, revision: event.target.value })}
          />
        </CatalogField>
        <CatalogField label={t.kind}>
          <CatalogSelect
            ariaLabel={t.kind}
            value={draft.kind}
            disabled={pending || mode !== "create"}
            options={[
              { value: "component", label: t.component },
              { value: "product", label: t.product },
            ]}
            onChange={(kind) => {
              if (kind === "component" || kind === "product")
                setDraft({
                  ...draft,
                  kind,
                  profile: { ...draft.profile, flags: blankCatalogProfile(kind).flags },
                });
            }}
          />
        </CatalogField>
        <CatalogField label={t.category}>
          <CatalogSelect
            ariaLabel={t.category}
            value={draft.profile.categoryId ?? ""}
            disabled={pending}
            options={[
              { value: "", label: t.noCategory },
              ...categoryOptions(workspace.categories, locale),
            ]}
            onChange={(category) => setCategory(category || null)}
          />
        </CatalogField>
        <CatalogField label={t.unit}>
          <CatalogSelect
            ariaLabel={t.unit}
            value={draft.profile.unit}
            disabled={pending}
            options={unitOptions(t)}
            onChange={(unit) => setProfile({ unit: unit as CatalogUnit })}
          />
        </CatalogField>
        <CatalogField label={t.stockMode}>
          <CatalogSelect
            ariaLabel={t.stockMode}
            value={draft.profile.stockMode}
            disabled={pending}
            options={[
              { value: "stocked", label: t.stocked },
              { value: "virtual", label: t.virtual },
              { value: "consumable", label: t.consumable },
            ]}
            onChange={(stockMode) =>
              setProfile({ stockMode: stockMode as CatalogProfile["stockMode"] })
            }
          />
        </CatalogField>
        <CatalogField label={t.visibility}>
          <CatalogSelect
            ariaLabel={t.visibility}
            value={draft.profile.visibility}
            disabled={pending}
            options={[
              { value: "staff", label: t.workspace },
              { value: "admin", label: t.managers },
            ]}
            onChange={(visibility) =>
              setProfile({ visibility: visibility === "admin" ? "admin" : "staff" })
            }
          />
        </CatalogField>
        <CatalogField label={t.selectedTemplate}>
          <CatalogSelect
            ariaLabel={t.selectedTemplate}
            value={draft.profile.templateItemId ?? ""}
            disabled={pending || hasSource || draft.profile.isTemplate}
            options={[
              { value: "", label: t.noTemplate },
              ...workspace.parts
                .filter((part) => part.id !== draft.id && part.profile.isTemplate)
                .map((part) => ({ value: part.id, label: catalogPartLabel(part) })),
            ]}
            onChange={(templateItemId) => setProfile({ templateItemId: templateItemId || null })}
          />
        </CatalogField>
      </div>
      <fieldset className="space-y-2 rounded-md border p-3">
        <legend className="px-1 text-sm font-medium">{t.flags}</legend>
        <div className="grid gap-x-4 sm:grid-cols-3">
          {catalogFlagKeys.map((flag) => (
            <CatalogCheckbox
              key={flag}
              id={`${id}-${flag}`}
              label={t[flag]}
              disabled={pending}
              checked={draft.profile.flags[flag]}
              change={(checked) =>
                setProfile({ flags: { ...draft.profile.flags, [flag]: checked } })
              }
            />
          ))}
          <CatalogCheckbox
            id={`${id}-template`}
            label={t.templateFlag}
            disabled={pending || draft.profile.templateItemId !== null}
            checked={draft.profile.isTemplate}
            change={(isTemplate) => setProfile({ isTemplate })}
          />
        </div>
      </fieldset>
      <CatalogField id={`${id}-description`} label={t.description}>
        <Textarea
          id={`${id}-description`}
          disabled={pending}
          value={draft.profile.description}
          onChange={(event) => setProfile({ description: event.target.value })}
        />
      </CatalogField>
      <CatalogField id={`${id}-notes`} label={t.notes}>
        <Textarea
          id={`${id}-notes`}
          disabled={pending}
          value={draft.profile.notes}
          onChange={(event) => setProfile({ notes: event.target.value })}
        />
      </CatalogField>
      <CatalogField id={`${id}-tags`} label={t.tags}>
        <Input
          id={`${id}-tags`}
          disabled={pending}
          placeholder={t.tagsHint}
          value={tags}
          onChange={(event) => setTags(event.target.value)}
        />
      </CatalogField>
      <RelatedPartsInput
        t={t}
        available={workspace.parts.filter((part) => part.id !== draft.id)}
        selected={draft.profile.relatedItemIds}
        pending={pending}
        change={(relatedItemIds) => setProfile({ relatedItemIds })}
      />
      {profiles.length > 0 && (
        <fieldset className="grid gap-3 rounded-md border p-3">
          <legend className="px-1 text-sm font-medium">{t.values}</legend>
          {profiles.map((definition) => (
            <ParameterInput
              key={definition.key}
              t={t}
              definition={definition}
              value={draft.profile.values.find((entry) => entry.key === definition.key)}
              pending={pending}
              change={(value) => setParameter(definition.key, value)}
            />
          ))}
        </fieldset>
      )}
    </CatalogEditorDialog>
  );
}

function RelatedPartsInput({
  t,
  available,
  selected,
  pending,
  change,
}: {
  t: CatalogWords;
  available: CatalogPart[];
  selected: string[];
  pending: boolean;
  change: (ids: string[]) => void;
}) {
  return (
    <fieldset className="space-y-2 rounded-md border p-3">
      <legend className="px-1 text-sm font-medium">{t.relatedParts}</legend>
      <CatalogSelect
        ariaLabel={t.addLink}
        value=""
        disabled={pending}
        options={[
          { value: "", label: t.pickPart },
          ...available
            .filter((part) => !selected.includes(part.id))
            .map((part) => ({ value: part.id, label: catalogPartLabel(part) })),
        ]}
        onChange={(partId) => {
          if (partId) change([...selected, partId]);
        }}
      />
      {available
        .filter((part) => selected.includes(part.id))
        .map((part) => (
          <div key={part.id} className="flex items-center justify-between gap-2 text-sm">
            <bdi className="min-w-0 break-words">{catalogPartLabel(part)}</bdi>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => change(selected.filter((id) => id !== part.id))}
            >
              {t.unlink}
            </Button>
          </div>
        ))}
    </fieldset>
  );
}

function ParameterInput({
  t,
  definition,
  value,
  pending,
  change,
}: {
  t: CatalogWords;
  definition: CatalogParameterDefinition;
  value?: CatalogParameterValue;
  pending: boolean;
  change: (value: CatalogParameterValue | null) => void;
}) {
  const id = useId();
  const { key, label, kind } = definition;

  if (kind === "boolean") {
    return (
      <CatalogField label={label}>
        <CatalogSelect
          ariaLabel={label}
          value={value === undefined ? "" : String(value.value)}
          disabled={pending}
          options={[
            { value: "", label: t.unset },
            { value: "true", label: t.enabled },
            { value: "false", label: t.disabled },
          ]}
          onChange={(next) =>
            change(next === "" ? null : { key, value: next === "true", unit: null })
          }
        />
      </CatalogField>
    );
  }

  if (kind === "number")
    return (
      <NumericParameterInput
        t={t}
        definition={definition}
        value={value}
        pending={pending}
        change={change}
      />
    );

  return (
    <CatalogField id={id} label={label}>
      <Input
        id={id}
        disabled={pending}
        value={typeof value?.value === "string" ? value.value : ""}
        onChange={(event) =>
          change(event.target.value === "" ? null : { key, value: event.target.value, unit: null })
        }
      />
    </CatalogField>
  );
}

function NumericParameterInput({
  t,
  definition,
  value,
  pending,
  change,
}: {
  t: CatalogWords;
  definition: CatalogParameterDefinition;
  value?: CatalogParameterValue;
  pending: boolean;
  change: (value: CatalogParameterValue | null) => void;
}) {
  const id = useId();
  const [unit, setUnit] = useState(value?.unit ?? definition.unit);
  const supported = definition.unit === null ? [] : compatibleCatalogUnits(definition.unit);
  const activeUnit = unit !== null && supported.includes(unit) ? unit : definition.unit;
  const { key, label } = definition;
  const number = typeof value?.value === "number" ? value.value : null;

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <CatalogField id={id} label={label}>
        <Input
          id={id}
          type="number"
          step="any"
          disabled={pending}
          value={number ?? ""}
          onChange={(event) => {
            const amount = event.target.valueAsNumber;
            change(Number.isFinite(amount) ? { key, value: amount, unit: activeUnit } : null);
          }}
        />
      </CatalogField>
      {activeUnit !== null && (
        <CatalogField label={t.unit}>
          <CatalogSelect
            ariaLabel={`${t.unit} · ${label}`}
            value={activeUnit}
            disabled={pending}
            options={unitOptions(t, supported)}
            onChange={(next) => {
              const nextUnit = next as CatalogUnit;
              setUnit(nextUnit);
              if (number !== null) change({ key, value: number, unit: nextUnit });
            }}
          />
        </CatalogField>
      )}
    </div>
  );
}
