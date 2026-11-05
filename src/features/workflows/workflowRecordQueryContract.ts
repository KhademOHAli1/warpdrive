import { z } from "zod";
import { isExactMappingDecimal } from "./mappingCompatibility";
import type { MappingTarget, MappingValueContract } from "./mappingTypes";
import { bindingSchema, type DraftBinding, draftBindingSchema } from "./schemas";
import { recordCreateEntities, recordCreateEntitySchema } from "./workflowRecordCreateContract";
import {
  boundedRecordSearchFilter,
  recordPickCandidateMax,
  recordSearchDepthMax,
  recordSearchEntryMax,
  recordSearchLimitMax,
  recordSearchOffsetMax,
} from "./workflowRecordQueryBounds";

export const recordLookupEntities = recordCreateEntities;
export const recordLookupEntitySchema = recordCreateEntitySchema;
export type RecordLookupEntity = z.infer<typeof recordLookupEntitySchema>;

const fieldKeys = [
  "id",
  "title",
  "name",
  "subject",
  "status",
  "value",
  "currency",
  "expectedCloseDate",
  "dueAt",
  "done",
  "createdAt",
  "updatedAt",
] as const;
const fieldSchema = z.enum(fieldKeys);
export type RecordSearchField = z.infer<typeof fieldSchema>;
export const recordSearchPrimary: Record<RecordLookupEntity, "title" | "name" | "subject"> = {
  deal: "title",
  lead: "title",
  person: "name",
  organization: "name",
  activity: "subject",
};
const common = ["id", "createdAt", "updatedAt"] as const;
const sales = ["title", "value", "currency", "expectedCloseDate"] as const;
export const recordSearchFields: Record<RecordLookupEntity, readonly RecordSearchField[]> = {
  deal: [...common, ...sales, "status"],
  lead: [...common, ...sales],
  person: [...common, "name"],
  organization: [...common, "name"],
  activity: [...common, "subject", "dueAt", "done"],
};

export function recordSearchFieldContract(
  entity: RecordLookupEntity,
  field: RecordSearchField,
): MappingValueContract {
  if (field === "id") return { kind: "entity", entity, nullable: false };
  if (field === "value") return { kind: "decimal", nullable: true };
  if (field === "expectedCloseDate") return { kind: "date", nullable: true };
  if (field === "dueAt" || field === "createdAt" || field === "updatedAt")
    return { kind: "instant", nullable: field === "dueAt" };
  return { kind: field === "done" ? "boolean" : "text", nullable: false };
}

const operators = [
  "equals",
  "notEquals",
  "contains",
  "notContains",
  "startsWith",
  "endsWith",
  "lessThan",
  "atMost",
  "greaterThan",
  "atLeast",
  "isEmpty",
  "isNotEmpty",
] as const;
const operatorSchema = z.enum(operators);
export type RecordSearchOperator = z.infer<typeof operatorSchema>;
export function recordSearchOperators(
  entity: RecordLookupEntity,
  field: RecordSearchField,
): readonly RecordSearchOperator[] {
  const { kind, nullable } = recordSearchFieldContract(entity, field);
  const base: RecordSearchOperator[] = ["equals", "notEquals"];
  if (kind === "text") base.push("contains", "notContains", "startsWith", "endsWith");
  if (kind === "decimal" || kind === "date" || kind === "instant")
    base.push("lessThan", "atMost", "greaterThan", "atLeast");
  if (nullable || kind === "text") base.push("isEmpty", "isNotEmpty");
  return base;
}

export function recordSearchOperatorNeedsValue(operator: RecordSearchOperator): boolean {
  return operator !== "isEmpty" && operator !== "isNotEmpty";
}

const filterCondition = z.strictObject({
  kind: z.literal("condition"),
  id: z.uuid(),
  field: fieldSchema,
  operator: operatorSchema,
  value: draftBindingSchema.optional(),
});
export type RecordSearchFilterCondition = z.infer<typeof filterCondition>;
export type RecordSearchFilterGroup = {
  kind: "group";
  id: string;
  combinator: "and" | "or";
  entries: RecordSearchFilterEntry[];
};
export type RecordSearchFilterEntry = RecordSearchFilterCondition | RecordSearchFilterGroup;

function filterGroupSchema(depth: number): z.ZodType<RecordSearchFilterGroup> {
  const entry =
    depth === 1 ? filterCondition : z.union([filterCondition, filterGroupSchema(depth - 1)]);
  return z.strictObject({
    kind: z.literal("group"),
    id: z.uuid(),
    combinator: z.enum(["and", "or"]),
    entries: z
      .array(entry)
      .min(1)
      .max(recordSearchEntryMax - 1),
  });
}
const boundedFilter = z.preprocess(
  (raw) => (boundedRecordSearchFilter(raw) ? raw : null),
  filterGroupSchema(recordSearchDepthMax),
);
const sort = z.strictObject({ field: fieldSchema, direction: z.enum(["asc", "desc"]) });
const searchSettings = {
  filter: boundedFilter.optional(),
  orderBy: z.array(sort).max(3).optional(),
  limit: draftBindingSchema.optional(),
  offset: draftBindingSchema.optional(),
};
export const recordSearchDraftConfig = z.strictObject({
  entity: recordLookupEntitySchema.optional(),
  ...searchSettings,
});
export type RecordSearchDraftConfig = z.infer<typeof recordSearchDraftConfig>;

export function recordSearchPageAmount(raw: unknown, kind: "limit" | "offset"): number | null {
  const value = typeof raw === "number" ? raw : isExactMappingDecimal(raw) ? Number(raw) : NaN;
  const min = kind === "limit" ? 1 : 0;
  const max = kind === "limit" ? recordSearchLimitMax : recordSearchOffsetMax;
  return Number.isSafeInteger(value) && value >= min && value <= max ? value : null;
}

export function recordSearchLiteralMatches(
  field: RecordSearchField,
  entity: RecordLookupEntity,
  value: DraftBinding,
): boolean {
  const binding = bindingSchema.safeParse(value);
  if (!binding.success) return false;
  if (binding.data.kind === "reference") return true;
  const { value: raw, literalType } = binding.data;
  const { kind } = recordSearchFieldContract(entity, field);
  if (kind === "instant" || kind === "date") return literalType === kind;
  if (literalType !== undefined) return false;
  if (kind === "entity") return z.uuid().safeParse(raw).success;
  if (kind === "decimal") return isExactMappingDecimal(raw) && raw.length <= 40;
  if (kind === "boolean") return typeof raw === "boolean";
  return typeof raw === "string" && raw.trim().length > 0 && raw.length <= 255;
}

function filterEntries(
  group: RecordSearchFilterGroup,
  path: readonly string[] = ["filter"],
): { entry: RecordSearchFilterEntry; path: readonly string[] }[] {
  return [
    { entry: group, path },
    ...group.entries.flatMap((entry, index) => {
      const current = [...path, "entries", String(index)];
      return entry.kind === "group" ? filterEntries(entry, current) : [{ entry, path: current }];
    }),
  ];
}

function validateCondition(
  entity: RecordLookupEntity,
  entry: RecordSearchFilterCondition,
): string | undefined {
  if (
    !recordSearchFields[entity].includes(entry.field) ||
    !recordSearchOperators(entity, entry.field).includes(entry.operator)
  )
    return "unknown_setting";
  if (!recordSearchOperatorNeedsValue(entry.operator))
    return entry.value === undefined ? undefined : "invalid_value";
  if (entry.value === undefined) return "required";
  return recordSearchLiteralMatches(entry.field, entity, entry.value) ? undefined : "invalid_value";
}

function checkFilter(
  entity: RecordLookupEntity,
  group: RecordSearchFilterGroup,
  context: z.RefinementCtx,
) {
  const ids = new Set<string>();
  for (const { entry, path } of filterEntries(group)) {
    if (ids.has(entry.id))
      context.addIssue({ code: "custom", path: [...path, "id"], message: "invalid_value" });
    ids.add(entry.id);
    if (entry.kind !== "condition") continue;
    const problem = validateCondition(entity, entry);
    if (problem !== undefined)
      context.addIssue({ code: "custom", path: [...path, "value"], message: problem });
  }
}

export const recordSearchConfig = z
  .strictObject({ entity: recordLookupEntitySchema, ...searchSettings })
  .superRefine((config, context) => {
    for (const kind of ["limit", "offset"] as const) {
      const raw = config[kind];
      if (
        raw?.kind === "value" &&
        (typeof raw.value !== "number" ||
          (raw.literalType !== undefined && raw.literalType !== "number") ||
          recordSearchPageAmount(raw.value, kind) === null)
      )
        context.addIssue({ code: "custom", path: [kind], message: "out_of_range" });
    }
    const sorts = new Set<RecordSearchField>();
    for (const [index, item] of (config.orderBy ?? []).entries()) {
      if (!recordSearchFields[config.entity].includes(item.field) || sorts.has(item.field))
        context.addIssue({
          code: "custom",
          path: ["orderBy", index, "field"],
          message: "unknown_setting",
        });
      sorts.add(item.field);
    }
    if (config.filter !== undefined) checkFilter(config.entity, config.filter, context);
  });
export type RecordSearchConfig = z.infer<typeof recordSearchConfig>;

export function recordSearchBindingEntries(config: RecordSearchDraftConfig) {
  const entries: { path: readonly string[]; value: DraftBinding; field?: RecordSearchField }[] = [];
  for (const key of ["limit", "offset"] as const) {
    const value = config[key];
    if (value !== undefined) entries.push({ path: [key], value });
  }
  if (config.filter !== undefined) {
    for (const { entry, path } of filterEntries(config.filter)) {
      if (entry.kind === "condition" && entry.value !== undefined)
        entries.push({ path: [...path, "value"], value: entry.value, field: entry.field });
    }
  }
  return entries;
}

export function recordSearchBindingTarget(
  nodeId: string,
  config: RecordSearchDraftConfig,
  path: readonly string[],
): MappingTarget | undefined {
  if (path.length === 1 && (path[0] === "limit" || path[0] === "offset"))
    return {
      nodeId,
      path,
      contract: { kind: "number", nullable: false },
      acceptedKinds: ["number", "decimal"],
      required: false,
      mode: "binding",
    };
  if (config.entity === undefined || config.filter === undefined) return undefined;
  const entry = filterEntries(config.filter).find(
    (item) =>
      path.length === item.path.length + 1 &&
      path.at(-1) === "value" &&
      item.path.every((segment, index) => segment === path[index]),
  )?.entry;
  if (
    entry?.kind !== "condition" ||
    !recordSearchFields[config.entity].includes(entry.field) ||
    !recordSearchOperatorNeedsValue(entry.operator)
  )
    return undefined;
  const field = recordSearchFieldContract(config.entity, entry.field);
  return {
    nodeId,
    path,
    contract: { ...field, nullable: false },
    required: true,
    mode: "binding",
    ...(field.kind === "decimal"
      ? { literalContext: "decimal" as const, acceptedKinds: ["decimal", "number"] as const }
      : {}),
  };
}

export const recordPickStrategies = ["RANDOM", "ROUND_ROBIN", "LOAD_BALANCED"] as const;
const strategy = z.enum(recordPickStrategies);
export const recordPickRelationFields = ["dealId", "leadId", "personId", "orgId"] as const;
export type RecordPickRelationField = (typeof recordPickRelationFields)[number];
const loadBalance = z.strictObject({
  entity: recordLookupEntitySchema,
  field: z.enum(recordPickRelationFields),
});
const candidates = z.array(z.uuid()).max(recordPickCandidateMax);
export const recordPickDraftConfig = z.strictObject({
  entity: recordLookupEntitySchema.optional(),
  strategy: strategy.optional(),
  recordIds: candidates.optional(),
  loadBalance: loadBalance.optional(),
});
export type RecordPickDraftConfig = z.infer<typeof recordPickDraftConfig>;

const relations = [
  { entity: "activity", field: "dealId", target: "deal" },
  { entity: "activity", field: "leadId", target: "lead" },
  { entity: "activity", field: "personId", target: "person" },
  { entity: "activity", field: "orgId", target: "organization" },
  { entity: "deal", field: "personId", target: "person" },
  { entity: "deal", field: "orgId", target: "organization" },
  { entity: "lead", field: "personId", target: "person" },
  { entity: "lead", field: "orgId", target: "organization" },
  { entity: "person", field: "orgId", target: "organization" },
] as const;
export function recordPickRelations(target: RecordLookupEntity) {
  return relations.filter((relation) => relation.target === target);
}

export const recordPickConfig = z
  .strictObject({
    entity: recordLookupEntitySchema,
    strategy,
    recordIds: candidates.min(1),
    loadBalance: loadBalance.optional(),
  })
  .superRefine((config, context) => {
    if (new Set(config.recordIds.map((id) => id.toLowerCase())).size !== config.recordIds.length)
      context.addIssue({ code: "custom", path: ["recordIds"], message: "invalid_value" });
    const balance = config.loadBalance;
    if (config.strategy === "LOAD_BALANCED" && balance === undefined)
      context.addIssue({ code: "custom", path: ["loadBalance"], message: "required" });
    else if (
      balance !== undefined &&
      (config.strategy !== "LOAD_BALANCED" ||
        !recordPickRelations(config.entity).some(
          (item) => item.entity === balance.entity && item.field === balance.field,
        ))
    )
      context.addIssue({ code: "custom", path: ["loadBalance"], message: "unknown_setting" });
  });
export type RecordPickConfig = z.infer<typeof recordPickConfig>;
