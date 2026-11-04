import { describe, expect, it } from "vitest";
import { CUSTOM_FIELD_TYPES } from "@/constants/customFieldTypes";
import { customFieldBindingSchema } from "./configurationBindings";
import {
  mappingField,
  mappingFieldId,
  mappingGraph,
  mappingTarget,
  reference,
} from "./mapping.test-helpers";
import { describeMappingOutputs, inspectMapping, legacyMappingTarget } from "./mappingCatalog";
import {
  numericLiteralFromInput,
  typedLiteralFromInput,
  validateLiteralIntent,
} from "./mappingLiteralIntent";
import { bindingSchema, copyScalarBindingSchema, draftBindingSchema } from "./schemas";

describe("scalar draft intent and executable boundary", () => {
  it("retains the minimal native number wire including zero", () => {
    for (const value of [0, -1.25, 1234.5]) {
      const literal = { kind: "value" as const, value };
      expect(bindingSchema.safeParse(literal).success).toBe(true);
      expect(validateLiteralIntent(literal)).toBeNull();
      expect(numericLiteralFromInput(String(value), "en")).toEqual(literal);
    }
  });

  it("preserves empty, sign, trailing-decimal and invalid numeric drafts as numeric intent", () => {
    for (const raw of ["", "-", "1.", "12oops"]) {
      const literal = numericLiteralFromInput(raw, "en");
      expect(literal).toEqual({ kind: "value", value: raw, literalType: "number" });
      expect(draftBindingSchema.safeParse(literal).success).toBe(true);
      expect(bindingSchema.safeParse(literal).success).toBe(false);
      expect(validateLiteralIntent(literal)).not.toBeNull();
    }
  });

  it("normalizes only explicit user numeric entry using the current locale and digit rules", () => {
    expect(numericLiteralFromInput("1,234.5", "en")).toEqual({ kind: "value", value: 1234.5 });
    expect(numericLiteralFromInput("1.234,5", "de")).toEqual({ kind: "value", value: 1234.5 });
    expect(numericLiteralFromInput("۱۲۳۴٫۵", "fa")).toEqual({ kind: "value", value: 1234.5 });
  });

  it("does not cast stored numeric strings or infer intent from text", () => {
    const raw = { kind: "value" as const, value: "12", literalType: "number" as const };
    expect(draftBindingSchema.safeParse(raw).success).toBe(true);
    expect(bindingSchema.safeParse(raw).success).toBe(false);
    expect(bindingSchema.safeParse({ kind: "value", value: "12" }).success).toBe(true);
    expect(validateLiteralIntent({ kind: "value", value: "12" })).toBeNull();
  });

  it("validates an optional native number tag without accepting mismatched native values", () => {
    expect(
      bindingSchema.safeParse({ kind: "value", value: 0, literalType: "number" }).success,
    ).toBe(true);
    for (const literalType of ["number", "date", "instant"]) {
      const raw = { kind: "value", value: false, literalType };
      expect(draftBindingSchema.safeParse(raw).success).toBe(true);
      expect(bindingSchema.safeParse(raw).success).toBe(false);
    }
  });

  it("requires a valid explicit civil-date tag and preserves raw invalid date input", () => {
    expect(bindingSchema.safeParse(typedLiteralFromInput("date", "2028-02-29")).success).toBe(true);
    for (const value of ["", "2026-02-29", "2030-03-20T12:00:00Z"]) {
      const raw = typedLiteralFromInput("date", value);
      expect(raw).toEqual({ kind: "value", value, literalType: "date" });
      expect(draftBindingSchema.safeParse(raw).success).toBe(true);
      expect(bindingSchema.safeParse(raw).success).toBe(false);
    }
    expect(validateLiteralIntent({ kind: "value", value: "2030-03-20" })).toBeNull();
  });

  it("validates explicit offset instants without losing raw precision or accepting a bare date", () => {
    const value = "2030-03-20T13:00:00.000000001+01:00";
    const literal = typedLiteralFromInput("instant", value);
    expect(bindingSchema.safeParse(literal).success).toBe(true);
    expect(literal.value).toBe(value);
    for (const invalid of ["2030-03-20", "12:00", "2030-03-20T12:00:00", ""]) {
      expect(bindingSchema.safeParse(typedLiteralFromInput("instant", invalid)).success).toBe(
        false,
      );
    }
  });

  it("rejects unknown tags, mixed branches and reference intent keys", () => {
    for (const raw of [
      { kind: "value", value: "x", literalType: "script" },
      { ...reference("read", "title"), literalType: "date" },
      { kind: "value", value: "x", nodeId: "read" },
      { kind: "value", value: "x", credential: "private" },
    ]) {
      expect(draftBindingSchema.safeParse(raw).success).toBe(false);
      expect(copyScalarBindingSchema.safeParse(raw).success).toBe(false);
    }
  });

  it("copies known incomplete typed drafts without normalizing or completing them", () => {
    for (const raw of [
      {},
      { kind: "value", literalType: "date" },
      { kind: "value", value: "-", literalType: "number" },
      { kind: "reference", nodeId: "read", path: [] },
    ]) {
      const copied = copyScalarBindingSchema.safeParse(raw);
      expect(copied.success).toBe(true);
      if (copied.success) expect(copied.data).toEqual(raw);
    }
    expect(
      copyScalarBindingSchema.safeParse({ kind: "value", value: "x".repeat(50001) }).success,
    ).toBe(false);
  });

  it("retains overflow input instead of emitting Infinity or a prior valid number", () => {
    const raw = "1" + "0".repeat(400);
    expect(numericLiteralFromInput(raw, "en")).toEqual({
      kind: "value",
      value: raw,
      literalType: "number",
    });
    expect(bindingSchema.safeParse({ kind: "value", value: Number.NaN }).success).toBe(false);
    expect(
      bindingSchema.safeParse({ kind: "value", value: Number.POSITIVE_INFINITY }).success,
    ).toBe(false);
  });

  it("keeps null, false, zero and empty text as different valid scalar values", () => {
    for (const value of [null, false, 0, ""]) {
      const raw = { kind: "value", value };
      const parsed = bindingSchema.safeParse(raw);
      expect(parsed.success).toBe(true);
      if (parsed.success) expect(parsed.data).toEqual(raw);
    }
  });

  it("does not widen global scalars or attach scalar tags to metadata-typed rich literals", () => {
    const value = { start: "2030-03-20", end: "2030-03-21" };
    expect(bindingSchema.safeParse({ kind: "value", value }).success).toBe(false);
    expect(customFieldBindingSchema.safeParse({ kind: "value", value }).success).toBe(true);
    expect(
      customFieldBindingSchema.safeParse({
        kind: "value",
        value: "2030-03-20",
        literalType: "date",
      }).success,
    ).toBe(false);
  });

  it("uses explicit field metadata for custom date literals but never infers scalar date text", () => {
    const graph = mappingGraph();
    const metadata = { status: "complete" as const, defs: [mappingField("date")] };
    const target = mappingTarget(graph, ["customFields", mappingFieldId], metadata);
    const raw = { kind: "value", value: "2030-03-20" };
    expect(inspectMapping(graph, "task", target, raw, metadata).compatibility).not.toBe(
      "incompatible",
    );
    const scalar = legacyMappingTarget("task", "scalar");
    const inspected = inspectMapping(graph, "task", scalar, raw);
    expect(inspected.issues).toEqual([]);
    expect(raw).not.toHaveProperty("literalType");
  });

  it("covers all sixteen target families using only actual qualified upstream outputs", () => {
    const graph = mappingGraph();
    for (const type of CUSTOM_FIELD_TYPES) {
      const metadata = { status: "complete" as const, defs: [mappingField(type)] };
      const target = mappingTarget(graph, ["customFields", mappingFieldId], metadata);
      const keys = describeMappingOutputs(graph, "task", metadata)
        .outputs.filter((output) => {
          const binding = { kind: "reference", nodeId: output.nodeId, path: [...output.path] };
          return (
            inspectMapping(graph, "task", target, binding, metadata).compatibility !==
            "incompatible"
          );
        })
        .map((output) => output.nodeId + "." + output.path.join("."));
      if (["text", "large_text", "autocomplete", "phone"].includes(type))
        expect(keys).toContain("read.title");
      else if (type === "user") expect(keys).toEqual(["read.ownerId"]);
      else if (type === "date") {
        expect(keys).toEqual(["read.expectedCloseDate"]);
        expect(keys).not.toContain("read.title");
      } else expect(keys).toEqual([]);
    }
  });

  it.each([
    ["address", { start: "", end: "" }],
    ["date_range", { country: "DE", city: "Berlin" }],
  ] as const)(
    "rejects cross-shape nested keys for %s without rewriting the draft",
    (type, value) => {
      const graph = mappingGraph();
      const metadata = { status: "complete" as const, defs: [mappingField(type)] };
      const target = mappingTarget(graph, ["customFields", mappingFieldId], metadata);
      const raw = { kind: "value", value };
      const before = structuredClone(raw);
      expect(inspectMapping(graph, "task", target, raw, metadata).compatibility).toBe(
        "incompatible",
      );
      expect(raw).toEqual(before);
      expect(draftBindingSchema.safeParse(raw).success).toBe(false);
      expect(customFieldBindingSchema.safeParse(raw).success).toBe(true);
    },
  );
});
