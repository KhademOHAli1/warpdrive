import { z } from "zod";

const localId = z.string().regex(/^[a-z][a-z0-9_]{0,47}$/u);
const labelText = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[^\p{Cc}\p{Zl}\p{Zp}]*$/u)
  .refine((value) => value.trim().length > 0);
const descriptionText = z
  .string()
  .min(1)
  .max(2_000)
  .refine((value) => !/[\p{Cc}\p{Zl}\p{Zp}]/u.test(value.replaceAll("\r", "").replaceAll("\n", "")))
  .refine((value) => value.trim().length > 0);
const label = z.strictObject({ fa: labelText, de: labelText, en: labelText });
const description = z.strictObject({
  fa: descriptionText,
  de: descriptionText,
  en: descriptionText,
});
const dueOffset = z.strictObject({
  basis: z.literal("calendar-days"),
  anchor: z.literal("project-start"),
  days: z.number().int().min(-3_650).max(3_650),
});
const commonIntent = {
  id: localId,
  label,
  stageId: localId,
  dependsOn: z.array(localId).max(256),
  dueOffset,
};
const intent = z.discriminatedUnion("kind", [
  z.strictObject({
    ...commonIntent,
    kind: z.literal("follow-up"),
    assigneeRoleId: localId,
  }),
  z.strictObject({
    ...commonIntent,
    kind: z.literal("assignment"),
    deliverableId: localId,
    internalProducerRoleId: localId,
    freelancerRoleId: localId,
  }),
  z.strictObject({
    ...commonIntent,
    kind: z.literal("review"),
    deliverableId: localId,
    assigneeRoleId: localId,
  }),
]);

export const templateManifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  templateId: localId,
  version: z.number().int().min(1).max(1_000_000),
  label,
  description,
  roles: z
    .array(
      z.strictObject({
        id: localId,
        kind: z.enum(["internal-producer", "freelancer-contact"]),
        label,
      }),
    )
    .min(1)
    .max(32),
  stages: z
    .array(
      z.strictObject({
        id: localId,
        label,
        dependsOn: z.array(localId).max(32),
      }),
    )
    .min(1)
    .max(32),
  deliverables: z
    .array(
      z.strictObject({
        id: localId,
        label,
        stageId: localId,
        responsibleRoleId: localId,
      }),
    )
    .max(128),
  intents: z.array(intent).max(256),
});

export type TemplateManifest = z.infer<typeof templateManifestSchema>;
