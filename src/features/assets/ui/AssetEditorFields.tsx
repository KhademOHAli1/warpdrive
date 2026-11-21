"use client";

import { type ComponentProps, useId } from "react";
import { CatalogField, CatalogSelect } from "@/features/inventory/catalog/ui/CatalogFields";
import { SalesInput, SalesTextarea } from "@/features/inventory/sales/ui/SalesFields";
import {
  type FormattingLocaleTag,
  type FormattingPreferences,
  formatNumber,
  localeTagForFormatting,
} from "@/lib/localeFormatting";
import { normalizeDigits, normalizeNumberInput } from "@/utils/normalizeNumberInput";
import type { AssetCategory, AssetField, AssetLocation, AssetsWorkspace } from "../contracts";
import { uniqueAssetKeys, validAssetValue } from "../registerRules";
import type { assetEditorMessages } from "./assetEditorMessages";

export type EditorWords = (typeof assetEditorMessages)["en"];
type FieldValue = AssetField["defaultValue"];
export type FieldDraft = Record<string, string>;

type DetailsSource = {
  name: string;
  code: string;
  categoryId: string | null;
  description: string | null;
  tags: string[];
  fieldValues: Record<string, FieldValue>;
};

export type DetailsDraft = {
  name: string;
  code: string;
  categoryId: string;
  description: string;
  tags: string;
  fields: FieldDraft;
};

function parseFieldNumber(input: string, locale: FormattingLocaleTag): number | undefined {
  const [mantissa, exponent, extra] = input.split(/[eE]/u);
  if (mantissa === undefined || extra !== undefined) return undefined;
  const normalized = normalizeNumberInput(mantissa, locale);
  if (normalized === null) return undefined;
  const power = exponent === undefined ? "0" : normalizeDigits(exponent).replace("−", "-");
  if (!/^[+-]?\d{1,3}$/u.test(power)) return undefined;
  const number = Number(`${normalized}e${power}`);
  return Number.isFinite(number) ? number : undefined;
}

export function toFieldInput(value: FieldValue, preferences: FormattingPreferences): string {
  if (value === null) return "";
  if (typeof value !== "number") return String(value);
  const options = { useGrouping: false, maximumFractionDigits: 20 };
  const rendered = formatNumber(value, preferences, options);
  if (parseFieldNumber(rendered, localeTagForFormatting(preferences)) === value) return rendered;
  const [mantissa, exponent] = String(value).split("e");
  const localized = formatNumber(Number(mantissa), preferences, options);
  return exponent === undefined ? localized : `${localized}e${exponent}`;
}

export function parseFieldInput(
  field: Pick<AssetField, "type" | "options">,
  input: string,
  locale: FormattingLocaleTag,
): FieldValue | undefined {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  switch (field.type) {
    case "number":
      return parseFieldNumber(trimmed, locale);
    case "boolean":
      return trimmed === "true" ? true : trimmed === "false" ? false : undefined;
    case "choice":
      return field.options.includes(trimmed) ? trimmed : undefined;
    case "text":
    case "date":
    case "link":
      return trimmed;
  }
}

export function fieldDraft(
  category: AssetCategory | undefined,
  preferences: FormattingPreferences,
  existing: Record<string, FieldValue> = {},
): FieldDraft {
  return Object.fromEntries(
    (category?.fields ?? []).map((field) => [
      field.id,
      toFieldInput(
        Object.hasOwn(existing, field.id) ? (existing[field.id] ?? null) : field.defaultValue,
        preferences,
      ),
    ]),
  );
}

export function detailsDraft(
  categories: AssetCategory[],
  preferences: FormattingPreferences,
  source?: DetailsSource,
): DetailsDraft {
  const category = categories.find(({ id }) => id === source?.categoryId);
  return {
    name: source?.name ?? "",
    code: source?.code ?? "",
    categoryId: source?.categoryId ?? "",
    description: source?.description ?? "",
    tags: source?.tags.join(", ") ?? "",
    fields: fieldDraft(category, preferences, source?.fieldValues),
  };
}

export function readDetails(
  draft: DetailsDraft,
  categories: AssetCategory[],
  locale: FormattingLocaleTag,
) {
  const fields = categories.find(({ id }) => id === draft.categoryId)?.fields ?? [];
  const fieldValues: Record<string, FieldValue> = {};
  for (const field of fields) {
    const value = parseFieldInput(field, draft.fields[field.id] ?? "", locale);
    if (value === undefined || !validAssetValue(field, value)) return null;
    fieldValues[field.id] = value;
  }
  const tags = draft.tags
    .split(/[,،]/u)
    .map((tag) => tag.trim())
    .filter(Boolean);
  if (!uniqueAssetKeys(tags)) return null;
  return {
    name: draft.name.trim(),
    code: draft.code.trim(),
    description: draft.description.trim() || null,
    categoryId: draft.categoryId || null,
    tags,
    fieldValues,
  };
}

export function readQuantity(input: string, locale: FormattingLocaleTag): number | null {
  const normalized = normalizeNumberInput(input, locale);
  if (normalized === null) return null;
  const units = Number(normalized);
  return Number.isSafeInteger(units) && units >= 0 && units <= 1_000_000 ? units : null;
}

export function fieldLines(raw: string): string[] {
  return raw
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
}

function locationLabel(location: AssetLocation, byId: ReadonlyMap<string, AssetLocation>): string {
  const path = [location.name];
  const visited = new Set([location.id]);
  let parentId = location.parentId;
  while (parentId !== null && !visited.has(parentId)) {
    const parent = byId.get(parentId);
    if (parent === undefined) break;
    visited.add(parent.id);
    path.push(parent.name);
    parentId = parent.parentId;
  }
  return `${path.reverse().join(" / ")} · ${location.code}`;
}

export function siteLocations({ locations }: AssetsWorkspace, siteId: string) {
  const local = locations.filter((location) => location.siteId === siteId);
  const byId = new Map(local.map((location) => [location.id, location]));
  return local
    .filter(({ archived }) => !archived)
    .map((location) => ({ value: location.id, label: locationLabel(location, byId) }));
}

export function EditorSelect({
  label,
  ...props
}: Omit<ComponentProps<typeof CatalogSelect>, "ariaLabel"> & { label: string }) {
  return (
    <CatalogField label={label}>
      <CatalogSelect ariaLabel={label} {...props} />
    </CatalogField>
  );
}

export function AssetFieldInput({
  field,
  label,
  required,
  pending,
  value,
  change,
  t,
}: {
  field: Pick<AssetField, "type" | "options">;
  label: string;
  required: boolean;
  pending: boolean;
  value: string;
  change: (value: string) => void;
  t: EditorWords;
}) {
  if (field.type === "choice" || field.type === "boolean") {
    const options =
      field.type === "choice"
        ? field.options.map((option) => ({ value: option, label: option }))
        : [
            { value: "true", label: t.yes },
            { value: "false", label: t.no },
          ];
    const index = options.findIndex((entry) => entry.value === value);
    return (
      <EditorSelect
        label={label}
        value={index < 0 ? "" : String(index)}
        options={[
          { value: "", label: t.unspecified },
          ...options.map((option, index) => ({ label: option.label, value: String(index) })),
        ]}
        disabled={pending}
        onChange={(next) => change(next === "" ? "" : (options[Number(next)]?.value ?? ""))}
      />
    );
  }
  return (
    <SalesInput
      label={label}
      value={value}
      required={required}
      disabled={pending}
      type={field.type === "date" ? "date" : field.type === "link" ? "url" : "text"}
      inputMode={field.type === "number" ? "decimal" : undefined}
      dir={field.type === "number" || field.type === "link" ? "ltr" : undefined}
      maxLength={1000}
      onChange={(event) => change(event.target.value)}
    />
  );
}

export function AssetDetailsFields({
  categories,
  draft,
  change,
  pending,
  model,
  t,
  preferences,
}: {
  categories: AssetCategory[];
  draft: DetailsDraft;
  change: (draft: DetailsDraft) => void;
  pending: boolean;
  model?: boolean;
  t: EditorWords;
  preferences: FormattingPreferences;
}) {
  const helpId = useId();
  const category = categories.find(({ id }) => id === draft.categoryId);

  function changeCategory(categoryId: string) {
    const next = categories.find(({ id }) => id === categoryId);
    const defaults = fieldDraft(next, preferences);
    const fields = Object.fromEntries(
      Object.keys(defaults).map((id) => [id, draft.fields[id] ?? defaults[id] ?? ""]),
    );
    change({ ...draft, categoryId, fields });
  }

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <SalesInput
          label={model === true ? t.modelName : t.name}
          value={draft.name}
          required
          disabled={pending}
          maxLength={120}
          onChange={(event) => change({ ...draft, name: event.target.value })}
        />
        <SalesInput
          label={model === true ? t.modelCode : t.code}
          value={draft.code}
          required
          disabled={pending}
          maxLength={80}
          dir="ltr"
          onChange={(event) => change({ ...draft, code: event.target.value })}
        />
      </div>
      <SalesTextarea
        label={t.description}
        value={draft.description}
        disabled={pending}
        maxLength={1000}
        rows={3}
        onChange={(event) => change({ ...draft, description: event.target.value })}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <EditorSelect
          label={t.category}
          value={draft.categoryId}
          options={[
            { value: "", label: t.noCategory },
            ...categories.map(({ id, name }) => ({ value: id, label: name })),
          ]}
          disabled={pending}
          onChange={changeCategory}
        />
        <div className="space-y-1">
          <SalesInput
            label={t.tags}
            value={draft.tags}
            disabled={pending}
            aria-describedby={helpId}
            onChange={(event) => change({ ...draft, tags: event.target.value })}
          />
          <p id={helpId} className="text-xs text-muted-foreground">
            {t.tagsHint}
          </p>
        </div>
      </div>
      {category !== undefined && category.fields.length > 0 && (
        <fieldset className="grid gap-3 rounded-md border p-3 sm:grid-cols-2">
          <legend className="px-1 text-sm font-medium">{t.fieldValues}</legend>
          {category.fields.map((field) => (
            <AssetFieldInput
              key={field.id}
              field={field}
              label={field.label}
              required={field.required}
              pending={pending}
              value={draft.fields[field.id] ?? ""}
              change={(value) =>
                change({ ...draft, fields: { ...draft.fields, [field.id]: value } })
              }
              t={t}
            />
          ))}
        </fieldset>
      )}
    </>
  );
}
