import { z } from "zod";
import type { Result } from "@/types/result";
import { type QualityPlanVersion, qualityPlanDraft } from "../quality/contracts";
import {
  type ManualReleaseArtifactKind,
  releaseArtifactKinds,
  releaseFixtureMaxFileBytes,
} from "./contracts";

const id = z.uuid().toLowerCase();
const releaseTarget = { releaseId: id };
const artifactTarget = { ...releaseTarget, artifactId: id };
export const releaseRoles = ["editor", "approver"] as const;

export const releaseMetadataCommand = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("createDraft"),
    itemId: id,
    revision: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9][A-Z0-9._-]{0,19}$/),
  }),
  z.strictObject({
    type: z.literal("approve"),
    ...releaseTarget,
    expectedQualityPlanVersionId: id.nullable().optional(),
  }),
  z.strictObject({
    type: z.literal("createQualityPlanVersion"),
    itemId: id,
    requestId: id,
    ...qualityPlanDraft,
  }),
  z.strictObject({
    type: z.literal("setQualityPlan"),
    ...releaseTarget,
    planVersionId: id.nullable(),
  }),
  z.strictObject({ type: z.literal("setRequirement"), itemId: id, required: z.boolean() }),
  z.strictObject({
    type: z.literal("setGrant"),
    itemId: id,
    userId: id,
    role: z.enum(releaseRoles).nullable(),
  }),
]);

export const releaseFileCommand = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("requestUpload"),
    ...releaseTarget,
    kind: z.enum(releaseArtifactKinds),
    name: z.string().trim().min(1).max(180),
    sizeBytes: z.number().int().positive().max(releaseFixtureMaxFileBytes),
  }),
  z.strictObject({ type: z.literal("confirmUpload"), ...artifactTarget }),
  z.strictObject({ type: z.literal("removeArtifact"), ...artifactTarget }),
]);

export const releaseDownloadInput = z.strictObject({ ...artifactTarget, orderId: id.optional() });
export type ReleaseRole = (typeof releaseRoles)[number];
export type ReleaseMetadataCommand = z.infer<typeof releaseMetadataCommand>;
export type ReleaseFileCommand = z.infer<typeof releaseFileCommand>;
export type ReleaseCommand = ReleaseMetadataCommand | ReleaseFileCommand;
export type ReleaseCommandResult = Result<
  {
    artifactId?: string;
    releaseId?: string;
    planVersionId?: string;
    post?: { url: string; fields: Record<string, string> };
  },
  string
>;

type ReleaseStaff = { id: string; name: string };
type ReleaseArtifactDetails = { id: string; name: string; sizeBytes: number; sha256: string };
export type ReleaseView = {
  id: string;
  revision: string;
  status: "draft" | "released";
  createdAt: string;
  createdBy: ReleaseStaff;
  approvedAt: string | null;
  approvedBy: ReleaseStaff | null;
  qualityPlanVersionId?: string | null;
  artifacts: (ReleaseArtifactDetails & { kind: ManualReleaseArtifactKind })[];
  pcbSourceArtifacts?: (ReleaseArtifactDetails & { kind: "pcbSource" })[];
  bom: { itemId: string; sku: string; name: string; quantity: number }[];
  hasPlanningBom?: true;
};

export type ReleaseWorkspace = {
  itemId: string;
  sku: string;
  name: string;
  releaseRequired: boolean;
  activeReleaseId: string | null;
  canEdit: boolean;
  canApprove: boolean;
  canManage: boolean;
  releases: ReleaseView[];
  qualityPlanVersions?: QualityPlanVersion[];
  intakeAvailable?: true;
  engineeringChangesAvailable?: true;
  engineeringChangeControlled?: true;
  grants: { userId: string; name: string; role: ReleaseRole }[];
  staff: ReleaseStaff[];
};

export type BuildRelease = {
  orderId: string;
  itemId: string;
  sku: string;
  name: string;
  projectId: string;
  templateRevision: number;
  release: ReleaseView;
};
