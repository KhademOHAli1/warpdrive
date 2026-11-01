import { canonicalScopeJson, compareScopeStrings } from "./scopeDraftCanonical";
import type { ScopeDraftContext, ScopeDraftInput } from "./scopeDraftSchemas";

type Code =
  | "unsupported_category"
  | "capability_review_required"
  | "enumeration_incomplete"
  | "category_review_pending"
  | "field_review_pending"
  | "third_party_unresolved"
  | "provenance_unresolved"
  | "portability_unresolved"
  | "invalid_access_exclusion"
  | "security_material";
export interface ScopeDraftBlocker {
  code: Code;
  store: string;
  recordRef?: string;
  field?: string;
}
type Category = ScopeDraftInput["categories"][number];
type Field = Category["records"][number]["decisions"][number];
type Mode = ScopeDraftInput["binding"]["mode"];

function categoryBlockers(
  category: Category,
  source: ScopeDraftContext["categories"][number] | undefined,
  mode: Mode,
): ScopeDraftBlocker[] {
  const blockers: ScopeDraftBlocker[] = [];
  const append = (code: Code) => blockers.push({ code, store: category.store });
  if (source?.capability === "unsupported" || category.decision.disposition === "unsupported")
    append("unsupported_category");
  if (source?.capability === "review_required") append("capability_review_required");
  if (source?.enumeration !== "complete") append("enumeration_incomplete");
  if (category.decision.review !== "reviewed") append("category_review_pending");
  if (
    mode === "access" &&
    category.decision.disposition === "exclude" &&
    category.decision.reason === "not_portable"
  )
    append("invalid_access_exclusion");
  return blockers;
}

function fieldBlockers(
  field: Field,
  mode: Mode,
  store: string,
  recordRef: string,
): ScopeDraftBlocker[] {
  const blockers: ScopeDraftBlocker[] = [];
  const add = (code: Code) => blockers.push({ code, store, recordRef, field: field.field });
  if (field.review !== "reviewed") add("field_review_pending");
  if (field.action === "include" && field.thirdParty !== "none") add("third_party_unresolved");
  if (field.action === "redact" && field.thirdParty !== "redacted" && field.thirdParty !== "none")
    add("third_party_unresolved");
  if (mode === "portability" && field.action !== "exclude" && field.portability !== "eligible")
    add("portability_unresolved");
  if (mode === "access" && field.action !== "include" && field.reason === "not_portable")
    add("invalid_access_exclusion");
  if (field.action === "include" && /password|token|secret|credential|recovery/iu.test(field.field))
    add("security_material");
  return blockers;
}

export function scopeDraftBlockers(
  input: ScopeDraftInput,
  context: ScopeDraftContext,
  signal: AbortSignal,
): readonly Readonly<ScopeDraftBlocker>[] {
  const blockers: ScopeDraftBlocker[] = [];
  const expected = new Map(context.categories.map((category) => [category.store, category]));
  for (const category of input.categories) {
    signal.throwIfAborted();
    blockers.push(...categoryBlockers(category, expected.get(category.store), input.binding.mode));
    for (const record of category.records) {
      signal.throwIfAborted();
      if (
        record.provenance.some(
          (item) => item.review !== "reviewed" || item.confidence === "ambiguous",
        )
      )
        blockers.push({
          code: "provenance_unresolved",
          store: category.store,
          recordRef: record.recordRef,
        });
      for (const field of record.decisions) {
        blockers.push(
          ...fieldBlockers(field, input.binding.mode, category.store, record.recordRef),
        );
      }
    }
  }
  return Object.freeze(
    blockers
      .sort((a, b) => compareScopeStrings(canonicalScopeJson(a), canonicalScopeJson(b)))
      .map((item) => Object.freeze(item)),
  );
}
