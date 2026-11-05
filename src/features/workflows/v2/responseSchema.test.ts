import { describe, expect, it } from "vitest";
import type { BlockJson } from "@/features/blocks/contracts";
import { classificationSchema } from "./aiActions";
import { isBlockJson, matchesResponseSchema, validResponseSchema } from "./responseSchema";

describe("workflow response contracts", () => {
  it("validates required objects, bounded arrays and field types", () => {
    const schema = {
      type: "object",
      properties: {
        accepted: { type: "boolean" },
        ids: { type: "array", items: { type: "string" }, maxItems: 2 },
      },
      required: ["accepted"],
      additionalProperties: false,
    };
    expect(matchesResponseSchema(schema, { accepted: true, ids: ["1"] })).toBe(true);
    const invalid: BlockJson[] = [
      { accepted: "true" },
      { ids: [] },
      { accepted: true, ids: ["1", "2", "3"] },
      { accepted: true, unknown: "private" },
    ];
    for (const value of invalid) expect(matchesResponseSchema(schema, value)).toBe(false);
    expect(validResponseSchema({ $ref: "https://remote/schema" })).toBe(false);
    expect(isBlockJson({ a: Infinity })).toBe(false);
    expect(isBlockJson(JSON.parse('{"__proto__":{"polluted":true}}'))).toBe(false);
  });
  it("makes exact classification keys and validates choices and score bounds", () => {
    const schema = classificationSchema([
      { key: "priority", type: "choice", choices: ["high", "low"] },
      { key: "qualified", type: "boolean" },
      { key: "score", type: "score", min: 0, max: 5 },
    ]);
    expect(schema).not.toBeNull();
    expect(matchesResponseSchema(schema, { priority: "high", qualified: true, score: 4 })).toBe(
      true,
    );
    expect(matchesResponseSchema(schema, { priority: "other", qualified: true, score: 8 })).toBe(
      false,
    );
    expect(
      classificationSchema([
        { key: "same", type: "boolean" },
        { key: "same", type: "boolean" },
      ]),
    ).toBeNull();
  });
});
