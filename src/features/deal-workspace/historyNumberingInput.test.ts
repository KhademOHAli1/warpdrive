import { describe, expect, it } from "vitest";
import { z } from "zod";
import { contactsRouter } from "@/features/contacts/router";
import { leadTimelineInput } from "@/features/leads/schemas";

const id = "11111111-1111-4111-8111-111111111111";

const [contactInput] = contactsRouter.contactTimeline._def.inputs;
if (!(contactInput instanceof z.ZodObject))
  throw new Error("Contact timeline input is not a Zod object");

describe("timeline display-preference input boundaries", () => {
  it("keeps existing inputs valid when numberingSystem is omitted", () => {
    expect(leadTimelineInput.parse({ leadId: id, locale: "de" })).toEqual({
      leadId: id,
      locale: "de",
    });
    expect(contactInput.parse({ entityType: "organization", entityId: id, locale: "fa" })).toEqual({
      entityType: "organization",
      entityId: id,
      locale: "fa",
    });
  });

  it.each(["latn", "arabext"])(
    "accepts the supported %s digit choice on both reads",
    (numberingSystem) => {
      expect(
        leadTimelineInput.safeParse({ leadId: id, locale: "fa", numberingSystem }).success,
      ).toBe(true);
      expect(
        contactInput.safeParse({
          entityType: "person",
          entityId: id,
          locale: "fa",
          numberingSystem,
        }).success,
      ).toBe(true);
    },
  );

  it.each(["thai", "", null, 123, { numberingSystem: "latn" }])(
    "rejects an unsupported digit choice at both read boundaries: %j",
    (numberingSystem) => {
      expect(leadTimelineInput.safeParse({ leadId: id, numberingSystem }).success).toBe(false);
      expect(
        contactInput.safeParse({ entityType: "person", entityId: id, numberingSystem }).success,
      ).toBe(false);
    },
  );
});
