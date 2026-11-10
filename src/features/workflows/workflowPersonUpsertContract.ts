import { z } from "zod";
import type { MappingTarget } from "./mappingTypes";
import { bindingSchema } from "./schemas";

export const workflowPersonUpsertKeyLimit = 128;
const noNul = (value: string) => !value.includes("\0");
const key = z.string().max(workflowPersonUpsertKeyLimit).trim().min(1).refine(noNul);
const name = z.string().max(255).trim().min(1).refine(noNul);
const orgId = z.uuid().nullable();

export const workflowPersonUpsertFields = ["name", "firstName", "lastName", "orgId"] as const;
export type WorkflowPersonUpsertField = (typeof workflowPersonUpsertFields)[number];

function bindingFor(schema: z.ZodType) {
  return bindingSchema.refine(
    (binding) =>
      binding.kind === "reference" ||
      (binding.literalType === undefined && schema.safeParse(binding.value).success),
    "invalid_value",
  );
}

export const workflowPersonUpsertConfig = z.strictObject({
  entity: z.literal("person"),
  key: bindingFor(key),
  fields: z.strictObject({
    name: bindingFor(name),
    firstName: bindingFor(name).optional(),
    lastName: bindingFor(name).optional(),
    orgId: bindingFor(orgId).optional(),
  }),
});

export const workflowPersonUpsertValues = z.strictObject({
  key,
  fields: z.strictObject({
    name,
    firstName: name.optional(),
    lastName: name.optional(),
    orgId: orgId.optional(),
  }),
});

export type WorkflowPersonUpsertConfig = z.infer<typeof workflowPersonUpsertConfig>;
export type WorkflowPersonUpsertValues = z.infer<typeof workflowPersonUpsertValues>;

export function workflowPersonUpsertTarget(
  nodeId: string,
  path: readonly string[],
): MappingTarget | undefined {
  const field =
    path.length === 2 && path[0] === "fields"
      ? workflowPersonUpsertFields.find((candidate) => candidate === path[1])
      : undefined;
  const isKey = path.length === 1 && path[0] === "key";
  if (!isKey && field === undefined) return undefined;
  return {
    nodeId,
    path,
    contract:
      field === "orgId"
        ? { kind: "entity", entity: "organization", nullable: true }
        : { kind: "text", nullable: false },
    required: isKey || field === "name",
    mode: "binding",
  };
}
