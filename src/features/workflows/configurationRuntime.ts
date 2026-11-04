import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import type { PreparedCustomFieldValidation } from "@/features/custom-fields/currentValidation";
import type { PermSetUser } from "@/features/permissions/effective";
import { assertReferenceVisible } from "@/features/permissions/referenceCheck";
import type { CustomFieldDef } from "@/types/customFields";
import { err, ok, type Result } from "@/types/result";
import { customFieldSettingsSchema } from "./configurationBindings";
import type { ConfigurationIssue } from "./configurationTypes";
import { describeMappingTarget, inspectMapping } from "./mappingCatalog";
import { resolveMapping } from "./mappingResolution";
import type { RunOutputs } from "./runTypes";
import type { Binding, WorkflowDefinition, WorkflowNode } from "./schemas";

export interface RunBindingContext {
  outputs: RunOutputs;
  definition: WorkflowDefinition;
}

function invalid(
  node: WorkflowNode,
  fieldId: string,
  code: ConfigurationIssue["code"] = "invalid_value",
) {
  const issues: ConfigurationIssue[] = [{ nodeId: node.id, path: ["customFields", fieldId], code }];
  return err(
    new AppError(ERROR_IDS.WORKFLOW_INVALID, "Invalid task custom configuration", { issues }),
  );
}

function canonicalIssues(
  node: WorkflowNode,
  defs: CustomFieldDef[],
  paths: readonly { path: readonly PropertyKey[] }[],
) {
  const ids = new Map(defs.map((def) => [def.key, def.id]));
  return paths.map(
    (issue): ConfigurationIssue => ({
      nodeId: node.id,
      path: [
        "customFields",
        ids.get(String(issue.path[0])) ?? "",
        "value",
        ...issue.path.slice(1).filter((part): part is string => typeof part === "string"),
      ],
      code: "invalid_value",
    }),
  );
}

function referenceKind(def: CustomFieldDef): "user" | "person" | "organization" | null {
  if (def.type === "org") return "organization";
  if (def.type === "user" || def.type === "person") return def.type;
  return null;
}

function resolveCustomReference(
  node: WorkflowNode,
  fieldId: string,
  binding: Extract<Binding, { kind: "reference" }>,
  run: RunBindingContext,
  defs: CustomFieldDef[],
): Result<unknown, AppError> {
  const metadata = { status: "complete" as const, defs };
  const selected = describeMappingTarget(
    run.definition,
    node.id,
    ["customFields", fieldId],
    metadata,
  );
  if (selected.state !== "ready") return invalid(node, fieldId, "reference_incompatible");
  const inspection = inspectMapping(run.definition, node.id, selected.target, binding, metadata);
  if (
    inspection.compatibility === "incompatible" ||
    inspection.issues.length > 0 ||
    inspection.source === undefined
  )
    return invalid(node, fieldId, inspection.issues[0]?.code ?? "reference_incompatible");
  const resolved = resolveMapping(binding, run.outputs, inspection.source);
  if (resolved.state === "missing")
    return err(
      new AppError(ERROR_IDS.WORKFLOW_BINDING_MISSING, "Task custom reference missing", {
        issues: [{ nodeId: node.id, path: ["customFields", fieldId], code: "reference_missing" }],
      }),
    );
  if (resolved.state === "invalid") return invalid(node, fieldId, "invalid_type");
  return ok(resolved.state === "null" ? null : resolved.value);
}

async function checkReferences(
  db: Db,
  actor: PermSetUser,
  node: WorkflowNode,
  defs: CustomFieldDef[],
  values: Record<string, unknown>,
  signal: AbortSignal,
) {
  const visibilityActor = {
    userId: actor.id,
    isActive: actor.isActive,
    sessionLive: true,
    isAdmin: actor.type === "admin",
    visibilityGroupIds: [...actor.groupIds],
    managedUserIds: [...(actor.managedUserIds ?? [])],
  };
  for (const def of defs) {
    const kind = referenceKind(def);
    const id = values[def.key];
    if (kind === null || typeof id !== "string") continue;
    const allowed = await assertReferenceVisible(db, visibilityActor, { kind, id }, signal);
    signal.throwIfAborted();
    if (!allowed.ok) {
      const issues: ConfigurationIssue[] = [
        { nodeId: node.id, path: ["customFields", def.id], code: "reference_unavailable" },
      ];
      return err(
        new AppError(ERROR_IDS.WORKFLOW_DENIED, "Custom reference unavailable", { issues }),
      );
    }
  }
  return ok(undefined);
}

// Called after the run lock/current original-actor hydration, before any activity effect.
// The prepared context is the exact fresh view also passed to the canonical writer.
export async function resolveTaskCustomFields(
  tx: Db,
  actor: PermSetUser,
  node: WorkflowNode,
  run: RunBindingContext,
  prepared: PreparedCustomFieldValidation,
  signal: AbortSignal,
): Promise<Result<Record<string, unknown>, AppError>> {
  signal.throwIfAborted();
  const raw = node.config.customFields === undefined ? {} : node.config.customFields;
  const parsed = customFieldSettingsSchema.safeParse(raw);
  if (!parsed.success) return invalid(node, "", "unknown_setting");
  const defs = prepared.defs;
  const byId = new Map(defs.map((def) => [def.id, def]));
  const values: Record<string, unknown> = {};
  for (const [id, binding] of Object.entries(parsed.data)) {
    const def = byId.get(id);
    if (def === undefined || def.targetEntity !== "activity" || def.archivedAt !== null)
      return invalid(node, id, "unknown_field");
    const resolved =
      binding.kind === "value"
        ? ok(binding.value)
        : resolveCustomReference(node, id, binding, run, defs);
    if (!resolved.ok) return resolved;
    const value = resolved.value;
    if (value === undefined) return invalid(node, id, "reference_missing");
    Object.defineProperty(values, def.key, {
      value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  const canonical = prepared.parseByKey(values);
  if (!canonical.success)
    return err(
      new AppError(ERROR_IDS.WORKFLOW_INVALID, "Invalid task custom configuration", {
        issues: canonicalIssues(node, defs, canonical.error.issues),
      }),
    );
  const visible = await checkReferences(tx, actor, node, defs, canonical.data, signal);
  if (!visible.ok) return visible;
  signal.throwIfAborted();
  return ok(canonical.data);
}
