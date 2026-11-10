import { z } from "zod";
import { ACTIVITY_PRIORITY_KEYS } from "@/constants/activityPriorities";
import { MAX_EMAIL_LEN, MAX_PHONE_LEN } from "@/features/contacts/fieldBounds";
import { emailPointSchema, phonePointSchema } from "@/features/contacts/schemas";
import { currencyCode, moneyAmount } from "@/features/currencies/currencySchema";
import type { MappingTarget, MappingValueContract } from "./mappingTypes";
import type recordCreateCopy from "./messages/workflows.en.json";
import { type Binding, bindingSchema } from "./schemas";

export const recordCreateEntities = ["deal", "lead", "person", "organization", "activity"] as const;
export const recordCreateEntitySchema = z.enum(recordCreateEntities);
export type RecordCreateEntity = z.infer<typeof recordCreateEntitySchema>;

type RecordCreateFieldKey = keyof (typeof recordCreateCopy)["recordCreateFields"];

export interface RecordCreateField {
  key: RecordCreateFieldKey;
  schema: z.ZodType<string | number>;
  required?: boolean;
  maxLength?: number;
  contract?: Omit<MappingValueContract, "nullable">;
  literalOnly?: boolean;
}

const uuid = z.uuid();
const text = z.string().trim().min(1).max(255);
const title: RecordCreateField = { key: "title", schema: text, required: true, maxLength: 255 };
const name: RecordCreateField = { key: "name", schema: text, required: true, maxLength: 255 };

function relation(key: RecordCreateFieldKey, entity: RecordCreateEntity): RecordCreateField {
  return { key, schema: uuid, maxLength: 36, contract: { kind: "entity", entity } };
}

function textField(key: RecordCreateFieldKey, maxLength = 255): RecordCreateField {
  return { key, schema: z.string().trim().min(1).max(maxLength), maxLength };
}

const organizationField = relation("orgId", "organization");
const personField = relation("personId", "person");
const salesFields: readonly RecordCreateField[] = [
  { key: "value", schema: moneyAmount, maxLength: 19, contract: { kind: "decimal" } },
  { key: "currency", schema: currencyCode, maxLength: 3 },
  {
    key: "expectedCloseDate",
    schema: z.iso.date(),
    maxLength: 10,
    contract: { kind: "date" },
  },
  personField,
  organizationField,
];

const addressKeys = ["street", "city", "region", "postal", "country"] as const;

export const recordCreateFields: Record<RecordCreateEntity, readonly RecordCreateField[]> = {
  deal: [
    title,
    { key: "pipelineId", schema: uuid, required: true, literalOnly: true },
    { key: "stageId", schema: uuid, required: true, literalOnly: true },
    ...salesFields,
  ],
  lead: [title, ...salesFields],
  person: [
    name,
    textField("firstName"),
    textField("lastName"),
    { key: "email", schema: emailPointSchema.shape.value, maxLength: MAX_EMAIL_LEN },
    {
      key: "phone",
      schema: z
        .string()
        .max(MAX_PHONE_LEN)
        .refine((value) => phonePointSchema.safeParse({ label: "", value, primary: true }).success),
      maxLength: MAX_PHONE_LEN,
    },
    organizationField,
  ],
  organization: [name, ...addressKeys.map((key) => textField(key))],
  activity: [
    { ...title, key: "subject" },
    { key: "priority", schema: z.enum(ACTIVITY_PRIORITY_KEYS), literalOnly: true },
    {
      key: "dueAt",
      schema: z.iso.datetime({ offset: true }).transform((value) => new Date(value).toISOString()),
      maxLength: 48,
      contract: { kind: "instant" },
    },
    relation("dealId", "deal"),
    relation("leadId", "lead"),
    personField,
    organizationField,
  ],
};

export function recordCreateFieldTarget(
  nodeId: string,
  entity: RecordCreateEntity,
  key: string,
): MappingTarget | undefined {
  const field = recordCreateFields[entity].find((candidate) => candidate.key === key);
  if (field === undefined) return undefined;
  const contract: Omit<MappingValueContract, "nullable"> = field.contract ?? { kind: "text" };
  return {
    nodeId,
    path: ["fields", field.key],
    contract: { ...contract, nullable: field.required !== true },
    required: field.required === true,
    mode: field.literalOnly === true ? "literal-only" : "binding",
    ...(contract.kind === "decimal"
      ? ({ literalContext: "decimal", acceptedKinds: ["decimal", "number"] } as const)
      : {}),
  };
}

export function recordCreateOutputContract(entity: RecordCreateEntity): MappingValueContract {
  return { kind: "entity", entity, nullable: false };
}

function validLiteral(field: RecordCreateField, binding: Extract<Binding, { kind: "value" }>) {
  if (binding.value === null) return field.required !== true;
  const kind = field.contract?.kind;
  if (kind === "date" || kind === "instant") {
    if (binding.literalType !== kind) return false;
  } else if (binding.literalType !== undefined) {
    return false;
  }
  if (kind === "decimal" && typeof binding.value !== "string") return false;
  return field.schema.safeParse(binding.value).success;
}

function hasLiteralRecord(binding: Binding | undefined): boolean {
  return binding?.kind === "value" && binding.value !== null;
}

const maximumFieldCount = Math.max(
  ...Object.values(recordCreateFields).map((fields) => fields.length),
);

export const recordCreateConfig = z
  .strictObject({
    entity: recordCreateEntitySchema,
    fields: z
      .unknown()
      .refine(
        (fields) =>
          fields !== null &&
          typeof fields === "object" &&
          !Array.isArray(fields) &&
          Object.keys(fields).length <= maximumFieldCount,
      )
      .pipe(z.record(z.string().min(1).max(32), bindingSchema)),
  })
  .superRefine((config, context) => {
    const allowed = recordCreateFields[config.entity];
    for (const key of Object.keys(config.fields)) {
      if (!allowed.some((field) => field.key === key)) {
        context.addIssue({ code: "custom", path: ["fields", key], message: "unknown_setting" });
      }
    }
    for (const field of allowed) {
      const value = config.fields[field.key];
      const path = ["fields", field.key];
      if (value === undefined) {
        if (field.required === true)
          context.addIssue({ code: "custom", path, message: "required" });
      } else if (
        value.kind === "reference" ? field.literalOnly === true : !validLiteral(field, value)
      ) {
        context.addIssue({ code: "custom", path, message: "invalid_value" });
      }
    }
    if (
      config.entity === "activity" &&
      hasLiteralRecord(config.fields.dealId) &&
      hasLiteralRecord(config.fields.leadId)
    ) {
      context.addIssue({ code: "custom", path: ["fields", "leadId"], message: "invalid_value" });
    }
  });

export type RecordCreateConfig = z.infer<typeof recordCreateConfig>;
