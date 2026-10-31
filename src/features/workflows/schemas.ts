import { z } from "zod";

const identifier = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);
const property = z
  .string()
  .min(1)
  .max(80)
  .refine((value) => !["__proto__", "prototype", "constructor"].includes(value));

export const bindingSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("value"),
    value: z.union([z.string().max(50_000), z.number().finite(), z.boolean(), z.null()]),
  }),
  z.strictObject({
    kind: z.literal("reference"),
    nodeId: identifier,
    path: z.array(property).min(1).max(8),
  }),
]);
export type Binding = z.infer<typeof bindingSchema>;
export type ValueType = "string" | "number" | "boolean" | "decimal";

export const nodeTypes = [
  "trigger.manual",
  "trigger.record",
  "record.read",
  "activity.create",
  "condition",
  "delay",
  "notification",
] as const;

export const nodeSchema = z.strictObject({
  id: identifier,
  type: z.enum(nodeTypes),
  version: z.literal(1),
  name: z.string().trim().min(1).max(120),
  config: z.record(z.string(), z.json()),
});

export const definitionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  nodes: z.array(nodeSchema).min(1).max(100),
  edges: z
    .array(
      z.strictObject({
        from: identifier,
        to: identifier,
        port: z.enum(["next", "true", "false"]),
      }),
    )
    .max(200),
});

export type WorkflowDefinition = z.infer<typeof definitionSchema>;
export type WorkflowNode = z.infer<typeof nodeSchema>;
export interface DefinitionIssue {
  code: string;
  nodeId?: string;
  field?: string;
}
