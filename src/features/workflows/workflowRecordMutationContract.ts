import { z } from "zod";
import { MAX_DOMAIN_LEN, MAX_INDUSTRY_LEN } from "@/features/contacts/fieldBounds";
import type { MappingTarget } from "./mappingTypes";
import { bindingSchema } from "./schemas";
import {
  type RecordCreateEntity,
  type RecordCreateField,
  recordCreateEntities,
  recordCreateEntitySchema,
  recordCreateFields,
} from "./workflowRecordCreateContract";

export const recordMutationEntities = recordCreateEntities;
export const recordMutationEntitySchema = recordCreateEntitySchema;
export type RecordMutationEntity = RecordCreateEntity;

type ExtraUpdateField = "domain" | "industry" | "location";

export interface RecordUpdateField extends Omit<RecordCreateField, "key"> {
  key: RecordCreateField["key"] | ExtraUpdateField;
  nullable: boolean;
}

const nullableKeys = new Set([
  "value",
  "expectedCloseDate",
  "personId",
  "orgId",
  "priority",
  "domain",
  "industry",
  "location",
]);

function fromCreate(entity: RecordMutationEntity, keys: readonly string[]): RecordUpdateField[] {
  return recordCreateFields[entity]
    .filter((field) => keys.includes(field.key))
    .map((field) => ({ ...field, nullable: nullableKeys.has(field.key) }));
}

function nullableText(key: ExtraUpdateField, maxLength: number): RecordUpdateField {
  return { key, maxLength, schema: z.string().trim().min(1).max(maxLength), nullable: true };
}

const salesKeys = ["title", "value", "currency", "expectedCloseDate"] as const;

export const recordUpdateFields: Record<RecordMutationEntity, readonly RecordUpdateField[]> = {
  deal: fromCreate("deal", [...salesKeys, "personId", "orgId"]),
  lead: fromCreate("lead", salesKeys),
  person: fromCreate("person", ["name", "firstName", "lastName", "orgId"]),
  organization: [
    ...fromCreate("organization", ["name"]),
    nullableText("domain", MAX_DOMAIN_LEN),
    nullableText("industry", MAX_INDUSTRY_LEN),
  ],
  activity: [...fromCreate("activity", ["subject", "priority"]), nullableText("location", 255)],
};

export function recordMutationTarget(
  nodeId: string,
  entity: RecordMutationEntity,
  path: readonly string[],
): MappingTarget | undefined {
  if (path.length === 1 && path[0] === "recordId") {
    return {
      nodeId,
      path,
      contract: { kind: "entity", entity, nullable: false },
      required: true,
      mode: "binding",
    };
  }
  if (path.length !== 2 || path[0] !== "fields") return undefined;
  const field = recordUpdateFields[entity].find((candidate) => candidate.key === path[1]);
  if (field === undefined) return undefined;
  const contract = field.contract ?? { kind: "text" as const };
  return {
    nodeId,
    path,
    contract: { ...contract, nullable: field.nullable },
    required: true,
    mode: field.literalOnly === true ? "literal-only" : "binding",
    ...(contract.kind === "decimal"
      ? ({ literalContext: "decimal", acceptedKinds: ["decimal", "number"] } as const)
      : {}),
  };
}

const recordIdBinding = bindingSchema.refine(
  (binding) =>
    binding.kind === "reference" ||
    (binding.literalType === undefined && z.uuid().safeParse(binding.value).success),
  "invalid_value",
);

export const recordDeleteConfig = z.strictObject({
  entity: recordMutationEntitySchema,
  recordId: recordIdBinding,
});

const fieldLimit = Math.max(...Object.values(recordUpdateFields).map((fields) => fields.length));

export const recordUpdateConfig = recordDeleteConfig
  .extend({
    fields: z
      .unknown()
      .refine(
        (fields) =>
          fields !== null &&
          typeof fields === "object" &&
          !Array.isArray(fields) &&
          Object.keys(fields).length <= fieldLimit,
      )
      .pipe(z.record(z.string().min(1).max(32), bindingSchema)),
  })
  .superRefine(({ entity, fields }, context) => {
    if (Object.keys(fields).length === 0)
      context.addIssue({ code: "custom", path: ["fields"], message: "required" });
    for (const [key, binding] of Object.entries(fields)) {
      const field = recordUpdateFields[entity].find((candidate) => candidate.key === key);
      if (field === undefined) {
        context.addIssue({ code: "custom", path: ["fields", key], message: "unknown_setting" });
        continue;
      }
      if (!validUpdateBinding(field, binding))
        context.addIssue({ code: "custom", path: ["fields", key], message: "invalid_value" });
    }
    if (fields.currency !== undefined && fields.value === undefined)
      context.addIssue({ code: "custom", path: ["fields", "value"], message: "required" });
  });

function validUpdateBinding(
  field: RecordUpdateField,
  binding: z.infer<typeof bindingSchema>,
): boolean {
  if (binding.kind === "reference") return field.literalOnly !== true;
  if (binding.value === null) return field.nullable && binding.literalType === undefined;
  const kind = field.contract?.kind;
  if (binding.literalType !== (kind === "date" ? "date" : undefined)) return false;
  if (kind === "decimal" && typeof binding.value !== "string") return false;
  return field.schema.safeParse(binding.value).success;
}

export type RecordUpdateConfig = z.infer<typeof recordUpdateConfig>;
