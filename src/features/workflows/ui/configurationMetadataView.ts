import type { RouterOutputs } from "@/lib/trpc-client";
import type { CustomFieldDef, CustomFieldOption } from "@/types/customFields";
import type { ConfigurationMetadata } from "../configurationTypes";

export type ConfigurationPage = Extract<
  RouterOutputs["workflows"]["configuration"],
  { state: "page" }
>;
export type ConfigurationOptionsPage = Extract<
  RouterOutputs["workflows"]["configurationOptions"],
  { state: "page" }
>;
export interface ConfigurationContinuation<T> {
  cursor: string | undefined;
  page: T;
}
export type ConfigurationNext =
  | { kind: "fields"; cursor: string }
  | { kind: "options"; fieldId: string; cursor: string | undefined };

function versionOne(value: unknown): boolean {
  return value === 1;
}
function sameProfile(first: ConfigurationPage, page: ConfigurationPage | ConfigurationOptionsPage) {
  return (
    page.workflowId === first.workflowId &&
    page.type === first.type &&
    versionOne(page.version) &&
    versionOne(first.version) &&
    page.fingerprint === first.fingerprint
  );
}
function definition(
  item: ConfigurationPage["items"][number],
  options: CustomFieldOption[],
): CustomFieldDef {
  return {
    id: item.id,
    key: item.key,
    type: item.type,
    name: item.name,
    isRequired: item.isRequired,
    isImportant: item.isImportant,
    order: item.order,
    options,
    targetEntity: "activity",
    showInAddForm: false,
    archivedAt: null,
  };
}
function fieldsView(
  first: ConfigurationPage,
  chain: readonly ConfigurationContinuation<ConfigurationPage>[],
) {
  const items = [...first.items];
  let cursor = first.nextCursor;
  for (const part of chain) {
    if (
      cursor === null ||
      part.cursor !== cursor ||
      !sameProfile(first, part.page) ||
      part.page.totalFields !== first.totalFields
    )
      return { items, cursor, stale: true };
    items.push(...part.page.items);
    cursor = part.page.nextCursor;
  }
  const ids = new Set(items.map((item) => item.id));
  return {
    items,
    cursor,
    stale:
      ids.size !== items.length ||
      items.length > first.totalFields ||
      (cursor === null && items.length !== first.totalFields),
  };
}
function optionsView(
  first: ConfigurationPage,
  field: ConfigurationPage["items"][number],
  chain: readonly ConfigurationContinuation<ConfigurationOptionsPage>[],
) {
  const items: CustomFieldOption[] = [];
  let cursor: string | undefined;
  let complete = field.optionCount === 0;
  for (const part of chain.filter((part) => part.page.fieldId === field.id)) {
    if (
      complete ||
      part.cursor !== cursor ||
      !sameProfile(first, part.page) ||
      part.page.query !== "" ||
      part.page.totalOptions !== field.optionCount
    )
      return { items, cursor, complete: false, stale: true };
    items.push(...part.page.items);
    complete = part.page.nextCursor === null;
    cursor = part.page.nextCursor ?? undefined;
  }
  return {
    items,
    cursor,
    complete,
    stale: items.length > field.optionCount || (complete && items.length !== field.optionCount),
  };
}
export function buildConfigurationMetadata(
  first: ConfigurationPage,
  fieldPages: readonly ConfigurationContinuation<ConfigurationPage>[],
  optionPages: readonly ConfigurationContinuation<ConfigurationOptionsPage>[],
): { metadata: ConfigurationMetadata; next: ConfigurationNext | null } {
  const fields = fieldsView(first, fieldPages);
  const defs: CustomFieldDef[] = [];
  let stale = fields.stale;
  let next: ConfigurationNext | null =
    fields.cursor === null ? null : { kind: "fields", cursor: fields.cursor };
  for (const field of fields.items) {
    const options = optionsView(first, field, optionPages);
    stale ||= options.stale;
    defs.push(definition(field, options.items));
    if (next === null && !options.complete)
      next = { kind: "options", fieldId: field.id, cursor: options.cursor };
  }
  return {
    metadata: {
      status: stale ? "stale" : next === null ? "complete" : "incomplete",
      defs,
      fingerprint: first.fingerprint,
    },
    next: stale ? null : next,
  };
}
