import { z } from "zod";
import type { Result } from "@/types/result";

const id = z.uuid().toLowerCase();
export const maxQualityEvidenceBytes = 5 * 1024 * 1024;
export const maxQualityPlanSteps = 32;

const stepIdentity = {
  key: id,
  label: z.string().trim().min(1).max(120),
  evidenceRequired: z.boolean(),
};
export const qualityPlanStep = z.discriminatedUnion("kind", [
  z.strictObject({
    ...stepIdentity,
    kind: z.literal("measurement"),
    unit: z.string().trim().min(1).max(32),
    minimum: z.number().nullable(),
    maximum: z.number().nullable(),
  }),
  z.strictObject({ ...stepIdentity, kind: z.literal("check") }),
]);

export const qualityPlanDraft = {
  name: z.string().trim().min(1).max(100),
  steps: z
    .array(qualityPlanStep)
    .min(1)
    .max(maxQualityPlanSteps)
    .refine((steps) => new Set(steps.map(({ key }) => key)).size === steps.length, {
      message: "Each test step must have its own identifier.",
    })
    .refine(
      (steps) =>
        steps.every((step) => {
          if (step.kind === "check") return true;
          const { minimum, maximum } = step;
          return (
            (minimum ?? maximum) !== null &&
            (minimum === null || maximum === null || minimum <= maximum)
          );
        }),
      { message: "Enter an inclusive measurement range or a single limit." },
    ),
};

export type QualityStepDraft = z.infer<typeof qualityPlanStep>;
export type QualityPlanVersion = {
  id: string;
  name: string;
  version: number;
  steps: QualityStepDraft[];
};

export const qualityQuery = z.strictObject({ siteId: id.optional(), targetId: id.optional() });
export type QualityQuery = z.infer<typeof qualityQuery>;

export const qualityEvidenceInput = z.strictObject({ targetId: id, runId: id, evidenceId: id });
export type QualityEvidenceInput = z.infer<typeof qualityEvidenceInput>;

export const qualityCommand = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("recordRun"),
    targetId: id,
    requestId: id,
    station: z.string().trim().min(1).max(100),
    results: z
      .array(
        z.strictObject({
          key: id,
          actual: z.union([z.number(), z.boolean()]),
          evidenceIds: z.array(id).max(4),
        }),
      )
      .min(1)
      .max(maxQualityPlanSteps),
  }),
  z.strictObject({
    type: z.literal("requestEvidence"),
    targetId: id,
    key: id,
    name: z.string().trim().min(1).max(180),
    sizeBytes: z.number().int().positive().max(maxQualityEvidenceBytes),
  }),
  z.strictObject({ type: z.literal("confirmEvidence"), targetId: id, evidenceId: id }),
]);
export type QualityCommand = z.infer<typeof qualityCommand>;

export type QualityError = "invalid" | "unavailable" | "state" | "evidence" | "conflict";
export type QualityCommandResult = Result<
  {
    runId?: string;
    passed?: boolean;
    evidenceId?: string;
    post?: { url: string; fields: Record<string, string> };
  },
  QualityError
>;

export type QualityTargetStatus = "pending" | "failed" | "passed";
export type QualityTargetSummary = {
  id: string;
  siteId: string;
  positionId: string;
  buildId: string;
  outputId: string;
  releaseId: string;
  releaseRevision: string;
  partCode: string;
  partName: string;
  serial: string;
  lot: string | null;
  status: QualityTargetStatus;
  createdAt: string;
};
export type QualityResultLine = {
  key: string;
  actual: number | boolean;
  passed: boolean;
  evidence: { id: string; name: string; sizeBytes: number }[];
};
export type QualityRun = {
  id: string;
  station: string;
  actorName: string;
  createdAt: string;
  passed: boolean;
  results: QualityResultLine[];
};
export type QualityTargetDetail = QualityTargetSummary & {
  plan: QualityPlanVersion;
  canRecord: boolean;
  runs: QualityRun[];
};
export type QualityWorkspace = {
  sites: { id: string; code: string; name: string }[];
  targets: QualityTargetSummary[];
  detail: QualityTargetDetail | null;
};
export type QualityWorkspaceResult = Result<QualityWorkspace, QualityError>;
