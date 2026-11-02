import { z } from "zod";
import { canonicalUuidSchema } from "../valueSchemas";

export const PROJECT_LIST_STATE_ORDER = [
  "planned",
  "active",
  "on-hold",
  "completed",
  "canceled",
  "archived",
] as const;
const stateSchema = z.enum(PROJECT_LIST_STATE_ORDER);
const defaultStates = ["planned", "active", "on-hold"] as const;
const anchorSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("deal"), id: canonicalUuidSchema }),
  z.strictObject({ kind: z.literal("person"), id: canonicalUuidSchema }),
  z.strictObject({ kind: z.literal("organization"), id: canonicalUuidSchema }),
]);

// This exact versioned shape is also the saved-filter payload. Unknown fields, duplicates,
// a future version and an invalid state fail rather than degrading to an unrestricted list.
export const projectListFilterSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    states: z
      .array(stateSchema)
      .min(1)
      .max(6)
      .refine((states) => new Set(states).size === states.length)
      .default([...defaultStates]),
    ownerUserId: canonicalUuidSchema.nullable().default(null),
    anchor: anchorSchema.nullable().default(null),
  })
  .transform((filter) => ({
    ...filter,
    states: PROJECT_LIST_STATE_ORDER.filter((state) => filter.states.includes(state)),
  }));

export const projectListRequestSchema = z.strictObject({
  filters: projectListFilterSchema,
  pageSize: z.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).max(2_048).nullable().default(null),
});

export type ProjectListFilter = z.infer<typeof projectListFilterSchema>;
export type ProjectListRequest = z.infer<typeof projectListRequestSchema>;

// Call only with already-parsed filters; preserve the fixed field order for continuation binding.
export function projectListFilterKey(filter: ProjectListFilter): string {
  return JSON.stringify({
    schemaVersion: filter.schemaVersion,
    states: filter.states,
    ownerUserId: filter.ownerUserId,
    anchor: filter.anchor === null ? null : { kind: filter.anchor.kind, id: filter.anchor.id },
  });
}
