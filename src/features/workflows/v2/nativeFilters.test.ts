import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { nativeBuiltinFields } from "./nativeBuiltinFields";
import { compileNativeFilters, type NativeFilter, nativeFindSchema } from "./nativeFilters";
import { deterministicNativeIndex, nativePickSchema } from "./nativePick";

describe("native query contracts", () => {
  it("rejects unknown fields, type mismatches, incompatible operators and excess bounds", () => {
    const fields = nativeBuiltinFields("deal");
    expect(() =>
      compileNativeFilters([{ field: "credentials", operator: "eq", value: "x" }], fields),
    ).toThrow();
    expect(() =>
      compileNativeFilters([{ field: "value", operator: "gte", value: "12" }], fields),
    ).toThrow();
    expect(() =>
      compileNativeFilters([{ field: "labels", operator: "gte", value: ["x"] }], fields),
    ).toThrow();
    expect(nativeFindSchema.safeParse({ objectName: "deal", limit: 101 }).success).toBe(false);
    expect(nativeFindSchema.safeParse({ objectName: "deal", offset: 10_001 }).success).toBe(false);
    expect(
      nativePickSchema.safeParse({ objectName: "person", recordIds: [], selectionMode: "RANDOM" })
        .success,
    ).toBe(false);
  });

  it("keeps nested groups and hostile text parameterized", () => {
    const query = new PgDialect().sqlToQuery(
      compileNativeFilters(
        {
          combinator: "or",
          conditions: [
            { field: "title", operator: "contains", value: "x%' OR true--" },
            {
              combinator: "and",
              conditions: [
                { field: "value", operator: "gte", value: 0 },
                { field: "value", operator: "lte", value: 10 },
              ],
            },
          ],
        },
        nativeBuiltinFields("deal"),
      ),
    );
    expect(query.sql).toContain(" OR ");
    expect(query.sql).toContain(" AND ");
    expect(query.sql).not.toContain("OR true--");
    expect(query.params).toContain("x%' OR true--");
  });

  it("bounds recursive condition trees and makes pick replay deterministic", () => {
    let filter: NativeFilter = { field: "title", operator: "eq", value: "A" };
    for (let i = 0; i < 7; i++) filter = { combinator: "and", conditions: [filter] };
    expect(() => compileNativeFilters(filter, nativeBuiltinFields("deal"))).toThrow();
    expect(deterministicNativeIndex("step-receipt-1", 7)).toBe(
      deterministicNativeIndex("step-receipt-1", 7),
    );
    expect(deterministicNativeIndex("step-receipt-1", 7)).toBeLessThan(7);
    expect(() => deterministicNativeIndex("step", 0)).toThrow();
  });
});
