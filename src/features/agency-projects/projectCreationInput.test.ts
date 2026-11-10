import { describe, expect, it } from "vitest";
import { projectCreateInputSchema } from "./projectCreationInput";

const intentId = "A1000000-0000-4000-8000-000000000001";
const ownerUserId = "B2000000-0000-4000-8000-000000000002";
const dealId = "C3000000-0000-4000-8000-000000000003";
const personId = "D4000000-0000-4000-8000-000000000004";
const orgId = "E5000000-0000-4000-8000-000000000005";
const input = { intentId, ownerUserId, title: "  Internal campaign  ", dealId };

describe("project creation ingress", () => {
  it("normalizes native IDs and outer title whitespace with explicit absent anchors", () => {
    expect(projectCreateInputSchema.parse(input)).toEqual({
      intentId: intentId.toLowerCase(),
      ownerUserId: ownerUserId.toLowerCase(),
      title: "Internal campaign",
      dealId: dealId.toLowerCase(),
      personId: null,
      orgId: null,
    });
  });

  it.each([
    "هماهنگ‌کننده تولید",
    "A\u0308nderung nach dem Gespräch",
    "Production coordination",
    "<Editor> & client",
    "Red heart \u2764\uFE0F",
  ])("preserves meaningful title text: %s", (title) => {
    expect(projectCreateInputSchema.parse({ ...input, title: `  ${title}  ` }).title).toBe(title);
  });

  it.each([{ dealId }, { personId }, { orgId }])(
    "accepts a single syntactically valid native CRM anchor: %j",
    (anchor) => {
      expect(
        projectCreateInputSchema.safeParse({ intentId, ownerUserId, title: "Project", ...anchor })
          .success,
      ).toBe(true);
    },
  );

  it("preserves multiple anchors for later native relationship and visibility admission", () => {
    const parsed = projectCreateInputSchema.parse({ ...input, personId, orgId });
    expect([parsed.dealId, parsed.personId, parsed.orgId]).toEqual(
      [dealId, personId, orgId].map((id) => id.toLowerCase()),
    );
  });

  it.each([{}, { dealId: null, personId: null, orgId: null }])(
    "rejects creation without any CRM anchor: %j",
    (anchors) => {
      expect(
        projectCreateInputSchema.safeParse({ intentId, ownerUserId, title: "Project", ...anchors })
          .success,
      ).toBe(false);
    },
  );

  it.each(["intentId", "ownerUserId", "dealId", "personId", "orgId"])(
    "rejects an invalid native UUID in %s",
    (field) => {
      expect(
        projectCreateInputSchema.safeParse({ ...input, [field]: "not-a-native-id" }).success,
      ).toBe(false);
    },
  );

  it.each([
    "actorId",
    "creatorUserId",
    "state",
    "revision",
    "archivedFrom",
    "budget",
    "authorized",
    "projectId",
    "projectEdit",
  ])("rejects caller-controlled server or financial fields: %s", (field) => {
    expect(projectCreateInputSchema.safeParse({ ...input, [field]: true }).success).toBe(false);
  });

  it.each(["", " \t\n ", "\u200c", "\uFE0F", "\u2066\u2069"])(
    "rejects an empty or invisible-only title: %j",
    (title) => {
      expect(projectCreateInputSchema.safeParse({ ...input, title }).success).toBe(false);
    },
  );

  it.each(["A\u0000B", "A\nB", "A\u0085B", "A\u2028B", "A\u2029B"])(
    "rejects controls and line separators inside a title: %j",
    (title) => {
      expect(projectCreateInputSchema.safeParse({ ...input, title }).success).toBe(false);
    },
  );

  it.each([{ title: null }, { title: 42 }, { title: false }, { title: [] }, { title: {} }])(
    "rejects non-text titles: %j",
    ({ title }) => {
      expect(projectCreateInputSchema.safeParse({ ...input, title }).success).toBe(false);
    },
  );

  it("bounds Unicode code points consistently for BMP and supplementary characters", () => {
    for (const character of ["A", "😀"]) {
      const title = character.repeat(160);
      expect(projectCreateInputSchema.parse({ ...input, title }).title).toBe(title);
      expect(
        projectCreateInputSchema.safeParse({ ...input, title: character.repeat(161) }).success,
      ).toBe(false);
    }
  });

  it.each(["A\uD800B", "A\uDC00B"])("rejects unpaired surrogates: %j", (title) => {
    expect(projectCreateInputSchema.safeParse({ ...input, title }).success).toBe(false);
  });

  it("does not mutate the supplied creation request", () => {
    const supplied = Object.freeze({ ...input });
    projectCreateInputSchema.parse(supplied);
    expect(supplied).toEqual(input);
  });
});
