import { z } from "zod";
import { assertNever, err, ok, type Result } from "@/types/result";
import { canonicalUuidSchema } from "../valueSchemas";
import type { TemplateManifest } from "./templateManifestSchemas";

const MAX_TEMPLATE_ROLE_BINDINGS = 32;
const roleIdSchema = z.string().min(1).max(48);
const internalBindingSchema = z.strictObject({
  roleId: roleIdSchema,
  kind: z.literal("internal-user"),
  userId: canonicalUuidSchema,
});
const contactBindingSchema = z.strictObject({
  roleId: roleIdSchema,
  kind: z.literal("external-contact"),
  personId: canonicalUuidSchema,
});
const bindingsSchema = z
  .array(z.discriminatedUnion("kind", [internalBindingSchema, contactBindingSchema]))
  .max(MAX_TEMPLATE_ROLE_BINDINGS);

export type TemplateRoleTarget =
  | Omit<z.infer<typeof internalBindingSchema>, "roleId">
  | Omit<z.infer<typeof contactBindingSchema>, "roleId">;
type IntentUse = { intentId: string; stageId: string } & (
  | { kind: "follow-up"; field: "assigneeRoleId" }
  | { kind: "review"; deliverableId: string; field: "assigneeRoleId" }
  | {
      kind: "assignment";
      deliverableId: string;
      field: "internalProducerRoleId" | "freelancerRoleId";
    }
);
export type TemplateRoleUse =
  | IntentUse
  | { kind: "deliverable"; deliverableId: string; stageId: string; field: "responsibleRoleId" };
export type TemplateRoleBindingPreview = {
  templateId: string;
  version: number;
  roles: {
    roleId: string;
    roleKind: TemplateManifest["roles"][number]["kind"];
    binding: TemplateRoleTarget | null;
    uses: TemplateRoleUse[];
  }[];
  offsetAssumptions: {
    intentId: string;
    dueOffset: TemplateManifest["intents"][number]["dueOffset"];
  }[];
};

function usesForIntent(
  intent: TemplateManifest["intents"][number],
  roleId: string,
): TemplateRoleUse[] {
  const base = { intentId: intent.id, stageId: intent.stageId };
  switch (intent.kind) {
    case "follow-up":
      return intent.assigneeRoleId === roleId
        ? [{ ...base, kind: intent.kind, field: "assigneeRoleId" }]
        : [];
    case "review":
      return intent.assigneeRoleId === roleId
        ? [{ ...base, kind: intent.kind, deliverableId: intent.deliverableId, field: "assigneeRoleId" }]
        : [];
    case "assignment":
      return (["internalProducerRoleId", "freelancerRoleId"] as const)
        .filter((field) => intent[field] === roleId)
        .map((field) => ({ ...base, kind: intent.kind, deliverableId: intent.deliverableId, field }));
    default:
      return assertNever(intent);
  }
}

function usesForRole(manifest: TemplateManifest, roleId: string): TemplateRoleUse[] {
  const deliverableUses: TemplateRoleUse[] = manifest.deliverables
    .filter((deliverable) => deliverable.responsibleRoleId === roleId)
    .map((deliverable) => ({
      kind: "deliverable",
      deliverableId: deliverable.id,
      stageId: deliverable.stageId,
      field: "responsibleRoleId",
    }));
  return [...deliverableUses, ...manifest.intents.flatMap((intent) => usesForIntent(intent, roleId))];
}

// The manifest has already crossed its graph boundary; a selected identity is still only syntax.
export function previewTemplateRoleBindings(
  manifest: TemplateManifest,
  bindings: unknown,
): Result<TemplateRoleBindingPreview, "invalid_template_bindings"> {
  const parsed = bindingsSchema.safeParse(bindings);
  if (!parsed.success) return err("invalid_template_bindings");
  const roles = new Map(manifest.roles.map((role) => [role.id, role.kind]));
  const selected = new Map<string, TemplateRoleTarget>();
  for (const binding of parsed.data) {
    const expected = binding.kind === "internal-user" ? "internal-producer" : "freelancer-contact";
    if (roles.get(binding.roleId) !== expected || selected.has(binding.roleId))
      return err("invalid_template_bindings");
    selected.set(
      binding.roleId,
      binding.kind === "internal-user"
        ? { kind: binding.kind, userId: binding.userId }
        : { kind: binding.kind, personId: binding.personId },
    );
  }
  return ok({
    templateId: manifest.templateId,
    version: manifest.version,
    roles: manifest.roles.map((role) => ({
      roleId: role.id,
      roleKind: role.kind,
      binding: selected.get(role.id) ?? null,
      uses: usesForRole(manifest, role.id),
    })),
    offsetAssumptions: manifest.intents.map((intent) => ({
      intentId: intent.id,
      dueOffset: { ...intent.dueOffset },
    })),
  });
}
