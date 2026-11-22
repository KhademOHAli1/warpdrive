import type { Result } from "@/types/result";

export const releaseArtifactKinds = [
  "pcbFabrication",
  "manufacturingBom",
  "placement",
  "enclosure",
  "firmware",
  "labelArtwork",
  "testInstructions",
] as const;

export type ManualReleaseArtifactKind = (typeof releaseArtifactKinds)[number];
export type ReleaseArtifactKind = ManualReleaseArtifactKind | "pcbSource";

export type ReleaseArtifact = {
  id: string;
  kind: ReleaseArtifactKind;
  name: string;
  sizeBytes: number;
  bytes: Blob;
};

export type ManufacturingRelease = {
  revision: string;
  status: "draft" | "released";
  artifacts: ReleaseArtifact[];
  releasedAt: string | null;
};

export type ReleaseFixtureState = {
  releases: ManufacturingRelease[];
  activeRevision: string | null;
  builds: { id: string; revision: string }[];
};

export type ReleaseFixtureCommand =
  | { type: "createDraft"; revision: string }
  | { type: "addArtifact"; revision: string; kind: ReleaseArtifactKind; file: File }
  | { type: "removeArtifact"; revision: string; artifactId: string }
  | { type: "approve"; revision: string }
  | { type: "previewBuild" };

export type ReleaseFixtureError =
  | "invalidRevision"
  | "revisionExists"
  | "releaseNotFound"
  | "releaseImmutable"
  | "emptyFile"
  | "fileTooLarge"
  | "invalidFileType"
  | "artifactNotFound"
  | "missingRequiredArtifacts"
  | "noActiveRelease";

export type ReleaseFixtureResult = Result<ReleaseFixtureState, ReleaseFixtureError>;

export const releaseFixtureMaxFileBytes = 25 * 1024 * 1024;
