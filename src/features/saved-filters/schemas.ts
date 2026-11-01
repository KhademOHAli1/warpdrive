import { z } from "zod";
import { ORG_FILTER_CONFIG, PERSON_FILTER_CONFIG } from "@/features/contacts/contactFilterConfig";
import { LEAD_CONDITION_CONFIG } from "@/features/leads/leadFilterFields";
import { buildFilterSchema, conditionValue, refineCondition } from "@/schemas/filterCondition";
import {
  DEAL_CONDITION_CONFIG,
  FILTER_FIELDS,
  FILTER_OPS,
  OPS_BY_FIELD,
  SORT_DIRS,
} from "./filterFields";
import { SAVED_VIEW_DEFINITION_VERSION } from "./viewDefinitionConstants";
import { savedViewPresentationSchemaFor } from "./viewPresentationSchema";

export { FILTER_FIELDS, OPS_BY_FIELD };

export const filterCondition = z
  .object({
    field: z.enum(FILTER_FIELDS),
    op: z.enum(FILTER_OPS),
    // Optional because isEmpty/isNotEmpty compare against no value; required for every other op
    // by the shared refinement, which also runs the numeric, date and labels value checks.
    value: conditionValue.optional(),
  })
  .superRefine((c, ctx) => {
    refineCondition(c, ctx, DEAL_CONDITION_CONFIG);
  });

export const filterDefinition = z.object({
  // How the conditions fold: "and" narrows, "or" widens. Defaults to "and" so a definition saved
  // before the key existed keeps meaning what it meant when it was written.
  combinator: z.enum(["and", "or"]).default("and"),
  conditions: z.array(filterCondition).default([]),
  // Derived "rotting" narrowing: keep only deals sitting in their stage past its rotting_days
  // threshold. Not expressible as a column condition (it compares stage age to a per-stage limit),
  // so it is a first-class flag applied by filterToSql via the joined stages row.
  rotting: z.boolean().optional(),
  sort: z.object({ field: z.enum(FILTER_FIELDS), dir: z.enum(SORT_DIRS) }).optional(),
});

// A saved view belongs to one entity, and each entity has its own field allow-list. Validating a
// definition against the wrong one would let a person view carry a deal-only field like stageId.
export const SAVED_FILTER_TARGET_ENTITIES = ["deal", "person", "organization", "lead"] as const;
export type SavedFilterTargetEntity = (typeof SAVED_FILTER_TARGET_ENTITIES)[number];

const DEFINITION_BY_ENTITY = {
  deal: filterDefinition,
  person: buildFilterSchema(PERSON_FILTER_CONFIG),
  organization: buildFilterSchema(ORG_FILTER_CONFIG),
  lead: buildFilterSchema(LEAD_CONDITION_CONFIG),
} as const;

// Read compatibility and new writes have separate contracts. A writer must reject a future
// constraint that a stripping object schema could otherwise weaken before persistence.
const BARE_WRITE_DEFINITION_BY_ENTITY = {
  deal: filterDefinition.strict().extend({
    conditions: z.array(filterCondition.strict()).default([]),
    sort: filterDefinition.shape.sort.unwrap().strict().optional(),
  }),
  person: buildFilterSchema(PERSON_FILTER_CONFIG, { strict: true }),
  organization: buildFilterSchema(ORG_FILTER_CONFIG, { strict: true }),
  lead: buildFilterSchema(LEAD_CONDITION_CONFIG, { strict: true }),
} as const;

function writeDefinitionFor<T extends Exclude<SavedFilterTargetEntity, "deal">>(targetEntity: T) {
  const definition = BARE_WRITE_DEFINITION_BY_ENTITY[targetEntity];
  return z.union([
    definition,
    z.strictObject({
      version: z.literal(SAVED_VIEW_DEFINITION_VERSION),
      targetEntity: z.literal(targetEntity),
      definition,
      presentation: savedViewPresentationSchemaFor(targetEntity).optional(),
    }),
  ]);
}

const WRITE_DEFINITION_BY_ENTITY = {
  deal: BARE_WRITE_DEFINITION_BY_ENTITY.deal,
  person: writeDefinitionFor("person"),
  organization: writeDefinitionFor("organization"),
  lead: writeDefinitionFor("lead"),
} as const;

// The compatibility validator for one target entity's stored or ad-hoc definition. Persisted
// definition writes use the strict map above so unsupported constraints cannot be discarded.
export function savedFilterDefinitionSchema(
  targetEntity: SavedFilterTargetEntity,
): (typeof DEFINITION_BY_ENTITY)[SavedFilterTargetEntity] {
  return DEFINITION_BY_ENTITY[targetEntity];
}

const savedFilterBase = {
  name: z.string().min(1).max(120),
  isShared: z.boolean().default(false),
};

export const saveFilterInput = z.discriminatedUnion("targetEntity", [
  z.object({
    ...savedFilterBase,
    targetEntity: z.literal("deal"),
    definition: WRITE_DEFINITION_BY_ENTITY.deal,
  }),
  z.object({
    ...savedFilterBase,
    targetEntity: z.literal("person"),
    definition: WRITE_DEFINITION_BY_ENTITY.person,
  }),
  z.object({
    ...savedFilterBase,
    targetEntity: z.literal("organization"),
    definition: WRITE_DEFINITION_BY_ENTITY.organization,
  }),
  z.object({
    ...savedFilterBase,
    targetEntity: z.literal("lead"),
    definition: WRITE_DEFINITION_BY_ENTITY.lead,
  }),
]);

// The update patch carries no targetEntity, so the caller supplies the entity of the row it is
// updating and gets a validator scoped to that entity's fields.
export function updateSavedFilterInputFor(targetEntity: SavedFilterTargetEntity) {
  return z.object({
    name: z.string().min(1).max(120).optional(),
    definition: WRITE_DEFINITION_BY_ENTITY[targetEntity].optional(),
    isShared: z.boolean().optional(),
  });
}

// combinator stays optional on the type even though the schema fills it, so a definition built by
// hand (a stored row, a test, an inline builder) reads as AND without restating the default.
export type FilterDefinition = Omit<z.infer<typeof filterDefinition>, "combinator"> & {
  combinator?: "and" | "or";
};
