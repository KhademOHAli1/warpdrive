import { err, ok, type Result } from "@/types/result";
import { validatePrivacyArchivePaths } from "./archiveSafety";
import { disclosureWithinBudget } from "./disclosureLimits";
import {
  type DisclosureContext,
  type DisclosureManifest,
  type DisclosureManifestCategory,
  type DisclosureManifestInput,
  disclosureContextSchema,
  disclosureManifestInputSchema,
} from "./disclosureSchemas";
import {
  type DisclosureFailure,
  sameDisclosureIds,
  validateDisclosureCategory,
} from "./disclosureValidation";

function validateEnvelope(
  request: DisclosureManifestInput,
  context: DisclosureContext,
): Result<true, DisclosureFailure> {
  if (JSON.stringify(request.binding) !== JSON.stringify(context.binding))
    return err("stale_scope");
  if (request.mode !== context.mode) return err("mode_mismatch");
  if (!context.scopeApproved) return err("scope_unapproved");
  if (!context.subjectVerified) return err("verification_required");
  if (!context.policy.activated || !context.policy.disclosureEnabled) return err("policy_disabled");
  if (
    request.mode === "portability" &&
    (context.policy.portabilityDecision !== "eligible" ||
      context.policy.portabilityReviewId === null)
  )
    return err("portability_ineligible");
  return sameDisclosureIds(
    request.categories.map((category) => category.id),
    context.expectedCategories.map((category) => category.id),
  )
    ? ok(true)
    : err("category_mismatch");
}

function pathMatchesScope(path: string, recordIds: readonly string[], scopeId: string): boolean {
  const folder = path.split("/")[1];
  return folder === scopeId || (folder !== undefined && recordIds.includes(folder));
}

function normalizePaths(
  categories: DisclosureManifestCategory[],
  scopeId: string,
  signal: AbortSignal,
): Result<DisclosureManifestCategory[], DisclosureFailure> {
  const paths = categories.flatMap((category) =>
    category.disposition === "include" ? category.files.map((file) => file.path) : [],
  );
  const checked = validatePrivacyArchivePaths(paths);
  if (!checked.ok) return err("unsafe_archive_path");
  const canonicalCategories: DisclosureManifestCategory[] = [];
  let cursor = 0;
  for (const category of categories) {
    signal.throwIfAborted();
    if (category.disposition !== "include") {
      canonicalCategories.push(category);
      continue;
    }
    const files: typeof category.files = [];
    for (const file of category.files) {
      const path = checked.value[cursor++];
      if (path === undefined) return err("unsafe_archive_path");
      if (!pathMatchesScope(path, file.recordIds, scopeId)) return err("record_mismatch");
      files.push({ ...file, path });
    }
    canonicalCategories.push({ ...category, files });
  }
  return ok(canonicalCategories);
}

function compileCategories(
  request: DisclosureManifestInput,
  context: DisclosureContext,
  signal: AbortSignal,
): Result<
  { categories: DisclosureManifestCategory[]; blockers: DisclosureManifest["blockers"] },
  DisclosureFailure
> {
  const categories: DisclosureManifestCategory[] = [];
  const blockers: DisclosureManifest["blockers"] = [];
  const expectedCategories = new Map(
    context.expectedCategories.map((category) => [category.id, category]),
  );
  for (const category of request.categories) {
    signal.throwIfAborted();
    const expected = expectedCategories.get(category.id);
    if (expected === undefined) return err("category_mismatch");
    const valid = validateDisclosureCategory(category, expected, request.mode);
    if (!valid.ok) return valid;
    if (category.disposition === "include") {
      categories.push({
        ...category,
        recordCount: expected.recordIds.length,
        files: category.files.map((file) => ({ ...file, recordCount: file.recordIds.length })),
      });
      continue;
    }
    categories.push({ ...category, recordCount: expected.recordIds.length });
    if (category.disposition === "unsupported")
      blockers.push({ categoryId: category.id, code: "adapter_unavailable", task: category.task });
  }
  const normalized = normalizePaths(categories, context.binding.scopeId, signal);
  return normalized.ok ? ok({ categories: normalized.value, blockers }) : normalized;
}

// Context and category decisions come from the current durably sealed server review.
// This pure contract never authenticates a caller or seals the underlying scope.
export function buildDisclosureManifest(
  input: unknown,
  trustedContext: unknown,
  signal: AbortSignal,
): Result<DisclosureManifest, DisclosureFailure> {
  signal.throwIfAborted();
  if (!disclosureWithinBudget(input, trustedContext, signal)) return err("manifest_limit");
  const current = disclosureContextSchema.safeParse(trustedContext);
  if (!current.success) return err("invalid_context");
  const parsed = disclosureManifestInputSchema.safeParse(input);
  if (!parsed.success) return err("invalid_manifest");
  const context = current.data;
  const request = parsed.data;
  const envelope = validateEnvelope(request, context);
  if (!envelope.ok) return envelope;
  const compiled = compileCategories(request, context, signal);
  if (!compiled.ok) return compiled;
  signal.throwIfAborted();
  return ok({
    formatVersion: 1,
    encoding: "utf-8",
    binding: context.binding,
    approvalId: context.approvalId,
    mode: request.mode,
    locale: request.locale,
    generatedAt: request.generatedAt,
    state: compiled.value.blockers.length === 0 ? "reviewed" : "blocked",
    categories: compiled.value.categories,
    blockers: compiled.value.blockers,
  });
}

export function encodeDisclosureManifest(manifest: DisclosureManifest): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(manifest));
}
