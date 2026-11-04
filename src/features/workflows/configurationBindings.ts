import { z } from "zod";
import type { CustomFieldType } from "@/constants/customFieldTypes";
import { bindingSchema } from "./schemas";

// Rich values belong only to task custom fields. Global scalar bindings stay scalar.
const rangeDraft = z.strictObject({ start: z.string().optional(), end: z.string().optional() });
const addressDraft = z.strictObject({
  street: z.string().optional(),
  city: z.string().optional(),
  region: z.string().optional(),
  postal: z.string().optional(),
  country: z.string().optional(),
  lat: z.number().finite().optional(),
  lng: z.number().finite().optional(),
});

export const customDraftLiteralSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z.array(z.string()),
  rangeDraft,
  addressDraft,
]);

export const customFieldBindingSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("value"), value: customDraftLiteralSchema }),
  bindingSchema.options[1],
]);
export type CustomFieldBinding = z.infer<typeof customFieldBindingSchema>;
export type CustomDraftLiteral = z.infer<typeof customDraftLiteralSchema>;
const fieldIdentity = z
  .string()
  .uuid()
  .refine((id) => id === id.toLowerCase());
export const customFieldSettingsSchema = z.record(fieldIdentity, customFieldBindingSchema);

// Copy permits reviewed incomplete selections, never mixed/unknown branches.
const copyLiteral = customFieldBindingSchema.options[0].partial();
const copyReference = bindingSchema.options[1]
  .extend({ path: z.array(bindingSchema.options[1].shape.path.element).max(8) })
  .partial();
export const copyCustomFieldBindingSchema = z.union([copyLiteral, copyReference]);
export const copyCustomFieldSettingsSchema = z.record(fieldIdentity, copyCustomFieldBindingSchema);

// Canonical rich schemas strip unknown object keys; shared workflow validation must
// reject cross-shape draft keys before asking those schemas to validate values.
export function customLiteralKeysAllowed(type: CustomFieldType, value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return true;
  if (type === "address") return addressDraft.safeParse(value).success;
  if (type === "date_range" || type === "time_range") return rangeDraft.safeParse(value).success;
  return true;
}
