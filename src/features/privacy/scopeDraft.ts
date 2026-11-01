import { createHash } from "node:crypto";
import { err, ok, type Result } from "@/types/result";
import { type ScopeDraftBlocker, scopeDraftBlockers } from "./scopeDraftBlockers";
import { canonicalScopeCategories, canonicalScopeJson } from "./scopeDraftCanonical";
import { checkScopeDraftBudget, SCOPE_DRAFT_BYTES_LIMIT } from "./scopeDraftLimits";
import { scopeDraftContextSchema, scopeDraftInputSchema } from "./scopeDraftSchemas";
import { type ScopeDraftFailure, validateScopeDraft } from "./scopeDraftValidation";

export interface ScopeDraftPlan {
  readonly formatVersion: 1;
  readonly state: "unsealed";
  readonly canonicalJson: string;
  readonly canonicalBytes: Uint8Array;
  readonly byteLength: number;
  readonly sha256: string;
  readonly blockers: readonly Readonly<ScopeDraftBlocker>[];
}

// A hash commits draft metadata only. The future sealer must verify current authority and sources.
export function buildScopeDraftPlan(
  input: unknown,
  trustedContext: unknown,
  signal: AbortSignal,
): Result<ScopeDraftPlan, ScopeDraftFailure> {
  signal.throwIfAborted();
  const draftBudget = checkScopeDraftBudget(input, signal);
  const contextBudget = checkScopeDraftBudget(trustedContext, signal);
  if (draftBudget === "limit" || contextBudget === "limit") return err("scope_draft_limit");
  if (contextBudget !== "ok") return err("invalid_scope_context");
  if (draftBudget !== "ok") return err("invalid_scope_draft");
  const context = scopeDraftContextSchema.safeParse(trustedContext);
  if (!context.success) return err("invalid_scope_context");
  const parsed = scopeDraftInputSchema.safeParse(input);
  if (!parsed.success) return err("invalid_scope_draft");
  const checked = validateScopeDraft(parsed.data, context.data, signal);
  if (!checked.ok) return checked;
  const blockers = scopeDraftBlockers(parsed.data, context.data, signal);
  const canonicalJson = canonicalScopeJson({
    formatVersion: 1,
    state: "unsealed",
    binding: context.data.binding,
    categories: canonicalScopeCategories(parsed.data, context.data),
    blockers,
  });
  const bytes = new TextEncoder().encode(canonicalJson);
  if (bytes.byteLength > SCOPE_DRAFT_BYTES_LIMIT) return err("scope_draft_limit");
  signal.throwIfAborted();
  return ok(
    Object.freeze({
      formatVersion: 1 as const,
      state: "unsealed" as const,
      canonicalJson,
      get canonicalBytes() {
        return bytes.slice();
      },
      byteLength: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      blockers,
    }),
  );
}
