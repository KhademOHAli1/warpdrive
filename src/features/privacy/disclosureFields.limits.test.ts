import { describe, expect, test } from "vitest";
import { disclosureFieldSchemas, MAX_FIELD_TEXT } from "./disclosureFields";

const textFields = [
  disclosureFieldSchemas.person.name,
  disclosureFieldSchemas.person.firstName,
  disclosureFieldSchemas.person.lastName,
  disclosureFieldSchemas.person.primaryEmail,
  disclosureFieldSchemas.user.name,
  disclosureFieldSchemas.user.email,
  disclosureFieldSchemas.email_message.fromEmail,
  disclosureFieldSchemas.email_message.fromName,
  disclosureFieldSchemas.email_message.subject,
  disclosureFieldSchemas.email_message.snippet,
  disclosureFieldSchemas.email_message.bodyText,
];
const textBoundary = "🚀".repeat(MAX_FIELD_TEXT / 2);

describe("disclosure text budgets count JavaScript UTF-16 units", () => {
  test.each(textFields)(
    "large text schema %# accepts the exact boundary and rejects two extra units",
    (schema) => {
      expect(schema.safeParse(textBoundary).success).toBe(true);
      const oversized = schema.safeParse(`${textBoundary}🚀`);
      expect(oversized.success).toBe(false);
      if (!oversized.success)
        expect(oversized.error.issues).toContainEqual(
          expect.objectContaining({
            code: "too_big",
            maximum: MAX_FIELD_TEXT,
            origin: "string",
          }),
        );
    },
  );

  for (const field of ["emails", "phones"] as const)
    for (const part of ["label", "value"] as const)
      test(`${field} ${part} applies its limit to UTF-16 units`, () => {
        const maximum = part === "label" ? 200 : 1000;
        const boundary = "🚀".repeat(maximum / 2);
        const point = { label: "synthetic", value: "synthetic@example.test", [part]: boundary };
        const schema = disclosureFieldSchemas.person[field];
        expect(schema.safeParse([point]).success).toBe(true);
        const oversized = schema.safeParse([{ ...point, [part]: `${boundary}🚀` }]);
        expect(oversized.success).toBe(false);
        if (!oversized.success)
          expect(oversized.error.issues).toContainEqual(
            expect.objectContaining({
              code: "too_big",
              maximum,
              origin: "string",
            }),
          );
      });

  test.each(["toEmails", "ccEmails"] as const)(
    "%s address text applies the 320-unit budget",
    (field) => {
      const boundary = "🚀".repeat(160);
      const schema = disclosureFieldSchemas.email_message[field];
      expect(schema.safeParse([boundary]).success).toBe(true);
      const oversized = schema.safeParse([`${boundary}🚀`]);
      expect(oversized.success).toBe(false);
      if (!oversized.success)
        expect(oversized.error.issues).toContainEqual(
          expect.objectContaining({
            code: "too_big",
            maximum: 320,
            origin: "string",
          }),
        );
    },
  );
});
