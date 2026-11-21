import { z } from "zod";
import { projectCreateInputSchema } from "@/features/agency-projects/projectCreationInput";
import { canonicalUuidSchema, revisionSchema } from "@/features/agency-projects/valueSchemas";
import {
  type ProjectEstimateType,
  type ProjectLabel,
  projectEstimatePointMaxCount,
  projectEstimatePointMaxLength,
  projectEstimatePointMinCount,
  projectEstimateTypes,
  projectLabelKinds,
  projectLabelsMaxCount,
  projectWorkStructureDescriptionMaxLength,
  projectWorkStructureNameMaxLength,
} from "./contracts";

const name = projectCreateInputSchema.shape.title.pipe(
  z.string().max(projectWorkStructureNameMaxLength),
);
const description = z
  .string()
  .trim()
  .max(projectWorkStructureDescriptionMaxLength)
  .refine((value) => !value.includes("\0") && !/\p{Cs}/u.test(value));
const target = { projectId: canonicalUuidSchema, revision: revisionSchema };
const uniqueValues = <T>(values: T[]) => new Set(values).size === values.length;

export const projectItemStructureInput = {
  labelIds: z.array(canonicalUuidSchema).max(projectLabelsMaxCount).refine(uniqueValues).optional(),
  estimatePointId: canonicalUuidSchema.nullable().optional(),
};

const labelInput = z.strictObject({
  id: canonicalUuidSchema,
  name,
  description,
  color: z
    .string()
    .regex(/^#[a-fA-F0-9]{6}$/u)
    .toLowerCase(),
  kind: z.enum(projectLabelKinds),
  parentId: canonicalUuidSchema.nullable(),
  position: z.number().int().min(0).lt(projectLabelsMaxCount),
});

export function validProjectLabelHierarchy(labels: ProjectLabel[]) {
  const groups = new Set(labels.filter(({ kind }) => kind === "group").map(({ id }) => id));
  return labels.every(
    ({ kind, parentId }) => parentId === null || (kind === "label" && groups.has(parentId)),
  );
}

export const saveProjectLabelsInput = z.strictObject({
  ...target,
  labels: z
    .array(labelInput)
    .max(projectLabelsMaxCount)
    .refine((labels) => uniqueValues(labels.map(({ id }) => id)))
    .refine((labels) => uniqueValues(labels.map((label) => label.name.toLowerCase())))
    .refine(validProjectLabelHierarchy),
});

export function validProjectEstimateValue(value: string, type: ProjectEstimateType): boolean {
  if (value === "") return false;
  const number = Number(value);
  return type === "points" ? Number.isFinite(number) && number > 0 : Number.isNaN(number);
}

const pointInput = z.strictObject({
  id: canonicalUuidSchema,
  value: z
    .string()
    .trim()
    .min(1)
    .max(projectEstimatePointMaxLength)
    .refine((value) => !/[\p{Cc}\p{Cs}]/u.test(value)),
  description,
  position: z.number().int().min(0).lt(projectEstimatePointMaxCount),
});
const scaleInput = z
  .strictObject({
    name,
    type: z.enum(projectEstimateTypes),
    points: z
      .array(pointInput)
      .min(projectEstimatePointMinCount)
      .max(projectEstimatePointMaxCount)
      .refine((points) => uniqueValues(points.map(({ id }) => id))),
  })
  .refine(
    ({ type, points }) =>
      points.every(({ value }) => validProjectEstimateValue(value, type)) &&
      uniqueValues(
        points.map(({ value }) =>
          type === "points" ? String(Number(value)) : value.toLowerCase(),
        ),
      ),
  );

export const saveProjectEstimateScaleInput = z.strictObject({
  ...target,
  scaleId: canonicalUuidSchema,
  scale: scaleInput.nullable(),
  replacements: z
    .array(
      z.strictObject({
        pointId: canonicalUuidSchema,
        replacementPointId: canonicalUuidSchema,
      }),
    )
    .max(projectEstimatePointMaxCount)
    .refine((points) => uniqueValues(points.map(({ pointId }) => pointId)))
    .optional(),
});

export const setProjectEstimateScaleInput = z.strictObject({
  ...target,
  scaleId: canonicalUuidSchema.nullable(),
});
