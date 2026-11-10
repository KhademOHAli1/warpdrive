import { describe, expect, it } from "vitest";
import { projectCommandSchema } from "./projectSchemas";
import { reasonSchema } from "./valueSchemas";

const invisibleReasons = [
  { label: "variation selector", reason: "\uFE0F" },
  { label: "combining grapheme joiner", reason: "\u034F" },
  { label: "mixed default-ignorable characters", reason: "\uFE0F\u034F" },
  { label: "default-ignorable surrounded by whitespace", reason: " \t\uFE0F\r\n " },
  { label: "format and default-ignorable characters", reason: "\u200c\uFE0F\u2066\u034F\u2069" },
  { label: "format, default-ignorable and whitespace", reason: " \u200c \u034F \uFE0F \n " },
];

const visibleReasons = [
  {
    label: "Persian with embedded joiners",
    input: "  هماهنگ\u200cکننده برنامه را تغییر داد.  ",
    expected: "هماهنگ\u200cکننده برنامه را تغییر داد.",
  },
  {
    label: "German with a preserved grapheme and combining sequence",
    input: "  A\u034F\u0308nderung nach dem Gespräch.  ",
    expected: "A\u034F\u0308nderung nach dem Gespräch.",
  },
  {
    label: "English explanation",
    input: "  Adjust timing after the review.  ",
    expected: "Adjust timing after the review.",
  },
  {
    label: "visible text with an emoji variation sequence",
    input: "  Keep the heart red \u2764\uFE0F.  ",
    expected: "Keep the heart red \u2764\uFE0F.",
  },
  {
    label: "multilingual text with internal tab and line breaks",
    input: "  Grund\tprüfen.\r\nThen confirm.\nرنگ\u200cها روشن بمانند.  ",
    expected: "Grund\tprüfen.\r\nThen confirm.\nرنگ\u200cها روشن بمانند.",
  },
];

describe("substantive lifecycle reason ingress", () => {
  it.each(invisibleReasons)("rejects a supplied $label reason", ({ reason }) => {
    expect(reasonSchema.safeParse(reason).success).toBe(false);
    expect(
      projectCommandSchema.safeParse({ action: "cancel", expectedRevision: 3, reason }).success,
    ).toBe(false);
  });

  it.each(visibleReasons)(
    "preserves $label after existing outer trimming",
    ({ input, expected }) => {
      expect(reasonSchema.parse(input)).toBe(expected);
      expect(
        projectCommandSchema.parse({ action: "cancel", expectedRevision: 3, reason: input }),
      ).toEqual({ action: "cancel", expectedRevision: 3, reason: expected });
    },
  );

  it.each(["", "   ", "\t\r\n", " \u00a0\t\n "])(
    "retains optional trimmed-empty reason data: %j",
    (reason) => {
      expect(reasonSchema.parse(reason)).toBe("");
      expect(projectCommandSchema.parse({ action: "start", expectedRevision: 3, reason })).toEqual({
        action: "start",
        expectedRevision: 3,
        reason: "",
      });
    },
  );

  it("retains an omitted optional reason without inventing a value", () => {
    const command = { action: "start", expectedRevision: 3 };
    expect(projectCommandSchema.parse(command)).toEqual(command);
    expect(projectCommandSchema.parse(command)).not.toHaveProperty("reason");
  });
});
