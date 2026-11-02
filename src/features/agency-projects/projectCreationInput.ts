import { z } from "zod";
import { canonicalUuidSchema } from "./valueSchemas";

const anchorIdSchema = canonicalUuidSchema.nullish().transform((value) => value ?? null);

const projectTitleSchema = z
  .string()
  .trim()
  .min(1)
  .max(320)
  .refine((value) => Array.from(value).length <= 160)
  .refine((value) => !/[\p{Cc}\p{Cs}\p{Zl}\p{Zp}]/u.test(value))
  .refine(
    (value) => value.replace(/[\p{Cf}\p{Default_Ignorable_Code_Point}]/gu, "").trim().length > 0,
  );

// Syntax only. Native relationship, visibility and authority admission belong to the create service.
export const projectCreateInputSchema = z
  .strictObject({
    intentId: canonicalUuidSchema,
    ownerUserId: canonicalUuidSchema,
    title: projectTitleSchema,
    dealId: anchorIdSchema,
    personId: anchorIdSchema,
    orgId: anchorIdSchema,
  })
  .refine((input) => input.dealId !== null || input.personId !== null || input.orgId !== null);

export type ProjectCreateInput = z.infer<typeof projectCreateInputSchema>;
