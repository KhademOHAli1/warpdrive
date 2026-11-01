import { err, ok, type Result } from "@/types/result";
import { canonicalScopeJson, scopeRecordSignature } from "./scopeDraftCanonical";
import { scopeDraftNativeKey } from "./scopeDraftLocators";
import type { ScopeDraftContext, ScopeDraftInput } from "./scopeDraftSchemas";

export type ScopeDraftFailure =
  | "invalid_scope_context"
  | "invalid_scope_draft"
  | "scope_draft_limit"
  | "scope_binding_mismatch"
  | "scope_coverage_mismatch"
  | "scope_record_mismatch"
  | "scope_duplicate";
type Category = ScopeDraftInput["categories"][number];
type ExpectedCategory = ScopeDraftContext["categories"][number];
const unique = (values: readonly string[]) => new Set(values).size === values.length;
function sameSet(actual: readonly string[], expected: readonly string[]): boolean {
  const wanted = new Set(expected);
  return actual.length === expected.length && actual.every((value) => wanted.has(value));
}

function uniqueCoverage(
  categories: readonly (Category | ExpectedCategory)[],
  signal: AbortSignal,
): boolean {
  if (!unique(categories.map((category) => category.store))) return false;
  const refs = new Set<string>();
  const locators = new Set<string>();
  for (const category of categories) {
    for (const record of category.records) {
      signal.throwIfAborted();
      const key = scopeDraftNativeKey(record.locator);
      if (refs.has(record.recordRef) || locators.has(key)) return false;
      refs.add(record.recordRef);
      locators.add(key);
      const fields =
        "fields" in record ? record.fields : record.decisions.map((decision) => decision.field);
      if (!unique(fields) || !unique(record.provenance.map((item) => item.evidenceRef)))
        return false;
    }
  }
  return true;
}

function checkCategory(
  category: Category,
  expected: ExpectedCategory,
  signal: AbortSignal,
): Result<true, ScopeDraftFailure> {
  if (category.adapterVersion !== expected.adapterVersion) return err("scope_record_mismatch");
  if (
    !sameSet(
      category.records.map((record) => record.recordRef),
      expected.records.map((record) => record.recordRef),
    )
  )
    return err("scope_coverage_mismatch");
  const records = new Map(expected.records.map((record) => [record.recordRef, record]));
  for (const record of category.records) {
    signal.throwIfAborted();
    const source = records.get(record.recordRef);
    if (
      source === undefined ||
      record.locator.store !== category.store ||
      scopeRecordSignature(record) !== scopeRecordSignature(source)
    )
      return err("scope_record_mismatch");
    if (
      !sameSet(
        record.decisions.map((decision) => decision.field),
        source.fields,
      )
    )
      return err("scope_coverage_mismatch");
    if (
      record.decisions.some(
        (decision) =>
          !record.provenance.some((item) => item.evidenceRef === decision.provenanceRef),
      )
    )
      return err("scope_record_mismatch");
  }
  return ok(true);
}

export function validateScopeDraft(
  input: ScopeDraftInput,
  context: ScopeDraftContext,
  signal: AbortSignal,
): Result<true, ScopeDraftFailure> {
  if (canonicalScopeJson(input.binding) !== canonicalScopeJson(context.binding))
    return err("scope_binding_mismatch");
  if (!uniqueCoverage(input.categories, signal) || !uniqueCoverage(context.categories, signal))
    return err("scope_duplicate");
  if (
    !sameSet(
      input.categories.map((category) => category.store),
      context.categories.map((category) => category.store),
    )
  )
    return err("scope_coverage_mismatch");
  const expected = new Map(context.categories.map((category) => [category.store, category]));
  for (const category of input.categories) {
    signal.throwIfAborted();
    const source = expected.get(category.store);
    if (source === undefined) return err("scope_coverage_mismatch");
    const checked = checkCategory(category, source, signal);
    if (!checked.ok) return checked;
  }
  return ok(true);
}
