import { z } from "zod";
import { EMAIL_MESSAGE_DIRECTION } from "@/constants/email";

export const MAX_FIELD_TEXT = 1_048_576;
export const MAX_CONTACT_POINTS = 1000;
// Disclosure budgets use JavaScript UTF-16 units; Zod's default string max counts code points.
const boundedText = (maximum: number) =>
  z.string().check((payload) => {
    if (payload.value.length > maximum)
      payload.issues.push({
        code: "too_big",
        origin: "string",
        maximum,
        inclusive: true,
        input: payload.value,
      });
  });
const text = boundedText(MAX_FIELD_TEXT);
const nullableText = text.nullable();
const date = z
  .union([z.iso.datetime({ offset: true }), z.date().transform((value) => value.toISOString())])
  .nullable();
const points = z
  .array(
    z
      .object({
        label: boundedText(200),
        value: boundedText(1000),
        primary: z.boolean().optional(),
      })
      .strict(),
  )
  .max(MAX_CONTACT_POINTS);
const addressList = z.array(boundedText(320)).max(MAX_CONTACT_POINTS);

// Free-form JSON, security state, ownership and HTML are deliberately absent from these projections.
export const disclosureFieldSchemas = {
  person: {
    id: z.uuid(),
    name: text,
    firstName: nullableText,
    lastName: nullableText,
    primaryEmail: nullableText,
    emails: points,
    phones: points,
    createdAt: date,
    updatedAt: date,
    deletedAt: date,
  },
  user: { id: z.uuid(), name: text, email: text, createdAt: date, updatedAt: date },
  email_message: {
    id: z.uuid(),
    direction: z.enum(EMAIL_MESSAGE_DIRECTION),
    fromEmail: text,
    fromName: nullableText,
    toEmails: addressList,
    ccEmails: addressList,
    subject: nullableText,
    snippet: nullableText,
    bodyText: nullableText,
    sentAt: date,
    createdAt: date,
  },
} satisfies Record<string, Record<string, z.ZodType>>;

export function disclosureFieldSchema(
  type: keyof typeof disclosureFieldSchemas,
  name: string,
): z.ZodType | undefined {
  const fields: Record<string, z.ZodType> = disclosureFieldSchemas[type];
  return Object.hasOwn(fields, name) ? fields[name] : undefined;
}
